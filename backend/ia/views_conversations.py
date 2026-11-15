"""
Discussions de l'assistant — `/api/v1/ia/conversations/`.

- `GET    conversations/?q=&etat=actives|archivees|toutes` — liste ; `q` cherche dans
          les titres ET dans le texte des messages (extrait de la correspondance renvoyé) ;
- `POST   conversations/`                 — nouvelle discussion (titre facultatif) ;
- `GET    conversations/<id>/`            — discussion et ses messages ;
- `PATCH  conversations/<id>/`            — renommer, épingler, archiver / désarchiver ;
- `DELETE conversations/<id>/`            — suppression (logique) ;
- `POST   conversations/<id>/messages/`   — envoyer un message, recevoir la réponse ;
- `POST   conversations/<id>/regenerer/`  — refaire la dernière réponse ;
- `GET    conversations/<id>/export/`     — la discussion en Markdown.

Strictement personnel : chaque requête est limitée aux discussions de l'appelant (un
identifiant étranger répond 404). Seuls l'envoi et la régénération appellent l'IA,
et eux seuls sont soumis au plafond de débit `ia`.
"""
import re
import uuid

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import assistant, client
from .models import Conversation, MessageConversation

TITRE_PAR_DEFAUT = 'Nouvelle discussion'
LONGUEUR_TITRE = 160
HISTORIQUE_MAX = 30
LONGUEUR_EXTRAIT = 140


def _message(m):
    return {'id': m.id, 'role': m.role, 'contenu': m.contenu, 'actions': m.actions or [],
            'outils': m.outils or [], 'modele': m.modele, 'created_at': m.created_at}


def _resume(c, q=''):
    donnees = {'id': str(c.id), 'titre': c.titre, 'epinglee': c.epinglee,
               'archivee': c.archivee, 'created_at': c.created_at, 'updated_at': c.updated_at,
               'nb_messages': getattr(c, 'nb_messages', None)}
    if q:
        trouve = c.messages.filter(contenu__icontains=q).order_by('-created_at').first()
        if trouve:
            donnees['extrait'] = extrait(trouve.contenu, q)
    return donnees


def extrait(texte, q, largeur=LONGUEUR_EXTRAIT):
    """Passage du texte autour de la première occurrence de `q` (sans casse)."""
    # Sans mise en forme Markdown (gras, tableaux, titres) : l'extrait se lit tel quel.
    texte = re.sub(r'\*\*|#{1,6}\s|\|', ' ', texte or '')
    texte = re.sub(r'\s*-{3,}\s*', ' ', texte)
    texte = ' '.join(texte.split())
    i = texte.lower().find((q or '').lower())
    if i < 0:
        return texte[:largeur]
    debut = max(0, i - largeur // 3)
    morceau = texte[debut:debut + largeur]
    return ('…' if debut else '') + morceau + ('…' if debut + largeur < len(texte) else '')


def titre_depuis(texte):
    """Titre automatique : la première question, raccourcie proprement."""
    t = ' '.join((texte or '').split())
    if len(t) <= 60:
        return t or TITRE_PAR_DEFAUT
    coupe = t[:60].rsplit(' ', 1)[0]
    return (coupe or t[:60]) + '…'


class _Base(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def conversations(self, request):
        return Conversation.objects.filter(proprietaire=request.user, is_deleted=False)

    def conversation(self, request, pk):
        try:
            uuid.UUID(str(pk))
        except ValueError:
            return None
        return self.conversations(request).filter(pk=pk).first()

    @staticmethod
    def introuvable():
        return Response({'detail': 'Discussion introuvable.'}, status=status.HTTP_404_NOT_FOUND)


class ConversationsView(_Base):
    def get(self, request):
        q = (request.query_params.get('q') or '').strip()[:100]
        etat = request.query_params.get('etat') or 'actives'
        qs = self.conversations(request)
        if etat == 'actives':
            qs = qs.filter(archivee=False)
        elif etat == 'archivees':
            qs = qs.filter(archivee=True)
        if q:
            qs = qs.filter(Q(titre__icontains=q) | Q(messages__contenu__icontains=q)).distinct()
        qs = qs.annotate(nb_messages=Count('messages')).order_by('-epinglee', '-updated_at')[:200]
        return Response([_resume(c, q) for c in qs])

    def post(self, request):
        titre = ' '.join(str(request.data.get('titre') or '').split())[:LONGUEUR_TITRE]
        c = Conversation.objects.create(proprietaire=request.user,
                                        titre=titre or TITRE_PAR_DEFAUT)
        return Response({**_resume(c), 'messages': []}, status=status.HTTP_201_CREATED)


class ConversationView(_Base):
    def get(self, request, pk):
        c = self.conversation(request, pk)
        if c is None:
            return self.introuvable()
        return Response({**_resume(c), 'messages': [_message(m) for m in c.messages.all()]})

    def patch(self, request, pk):
        c = self.conversation(request, pk)
        if c is None:
            return self.introuvable()
        champs = []
        if 'titre' in request.data:
            titre = ' '.join(str(request.data.get('titre') or '').split())[:LONGUEUR_TITRE]
            if not titre:
                return Response({'titre': 'Le titre ne peut pas être vide.'},
                                status=status.HTTP_400_BAD_REQUEST)
            c.titre = titre
            champs.append('titre')
        for nom in ('epinglee', 'archivee'):
            if nom in request.data:
                setattr(c, nom, bool(request.data.get(nom)))
                champs.append(nom)
        if champs:
            # « Modifiée le » ne bouge pas pour un simple rangement : la liste reste stable.
            c.save(update_fields=champs)
        return Response(_resume(c))

    def delete(self, request, pk):
        c = self.conversation(request, pk)
        if c is None:
            return self.introuvable()
        c.is_deleted, c.deleted_at = True, timezone.now()
        c.save(update_fields=['is_deleted', 'deleted_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class _Repondre(_Base):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'ia'

    def repondre(self, request, c):
        """Fait répondre l'assistant au dernier message de la discussion."""
        historique = [{'role': m.role, 'content': m.contenu}
                      for m in c.messages.order_by('-created_at', '-id')[:HISTORIQUE_MAX]][::-1]
        try:
            r = assistant.repondre(request.user, historique)
        except client.IaIndisponible as exc:
            return Response({'detail': str(exc), 'code': 'IA_INACTIVE'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except client.IaErreur as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        m = MessageConversation.objects.create(
            conversation=c, role='assistant', contenu=r['reponse'], actions=r['actions'],
            outils=r['outils'], modele=r.get('modele') or '')
        Conversation.objects.filter(pk=c.pk).update(updated_at=timezone.now())
        return Response({'message': _message(m)}, status=status.HTTP_201_CREATED)


class MessagesView(_Repondre):
    def post(self, request, pk):
        c = self.conversation(request, pk)
        if c is None:
            return self.introuvable()
        contenu = str(request.data.get('contenu') or '').strip()
        if not contenu:
            return Response({'contenu': 'Le message est vide.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(contenu) > assistant.MAX_CARACTERES:
            return Response({'contenu': f'{assistant.MAX_CARACTERES} caractères au maximum.'},
                            status=status.HTTP_400_BAD_REQUEST)
        question = MessageConversation.objects.create(conversation=c, role='user', contenu=contenu)
        if c.titre == TITRE_PAR_DEFAUT and not c.messages.exclude(pk=question.pk).exists():
            c.titre = titre_depuis(contenu)
            c.save(update_fields=['titre'])
        reponse = self.repondre(request, c)
        # La question reste enregistrée même si l'IA échoue : « Réessayer » la reprend.
        if reponse.status_code == status.HTTP_201_CREATED:
            reponse.data['question'] = _message(question)
            reponse.data['titre'] = c.titre
        return reponse


class RegenererView(_Repondre):
    def post(self, request, pk):
        c = self.conversation(request, pk)
        if c is None:
            return self.introuvable()
        dernier = c.messages.order_by('-created_at', '-id').first()
        if dernier is None:
            return Response({'detail': 'La discussion est vide.'}, status=status.HTTP_400_BAD_REQUEST)
        if dernier.role == 'assistant':
            dernier.delete()
        return self.repondre(request, c)


class ExportView(_Base):
    def get(self, request, pk):
        c = self.conversation(request, pk)
        if c is None:
            return self.introuvable()
        lignes = [f'# {c.titre}', '',
                  f"_Discussion avec l'assistant SDGPS — {timezone.localtime(c.created_at):%d/%m/%Y %H:%M}_", '']
        for m in c.messages.all():
            qui = 'Vous' if m.role == 'user' else 'Assistant'
            lignes += [f'**{qui}** — {timezone.localtime(m.created_at):%d/%m/%Y %H:%M}', '', m.contenu, '']
        nom = ''.join(ch if ch.isalnum() or ch in '-_ ' else '_' for ch in c.titre)[:60].strip() or 'discussion'
        return Response({'nom_fichier': f'{nom}.md', 'contenu': '\n'.join(lignes)})
