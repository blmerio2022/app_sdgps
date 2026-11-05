"""Format des dates dans le RAPPORT PDF.

`date_bornage` (affaires) et `date_session` (sessions) sont les deux seules dates de l'app
dépourvues d'heure : le rapport doit les afficher en ``jj/mm/aaaa``, exactement comme
l'interface (cf. `frontend/src/app/shared/utils/date-format.util.ts`).
"""
from datetime import date, datetime, timedelta, timezone as dt_timezone

from django.test import SimpleTestCase

from pieces.report import _fmt_date


class FormatDateRapportTests(SimpleTestCase):
    def test_format_sans_heure(self):
        self.assertEqual(_fmt_date(datetime(2026, 7, 21, 14, 5, 9, tzinfo=dt_timezone.utc)),
                         '21/07/2026')

    def test_aucune_heure_dans_la_sortie(self):
        rendu = _fmt_date(datetime(2026, 7, 21, 14, 5, 9, tzinfo=dt_timezone.utc))
        self.assertNotIn(':', rendu)
        self.assertRegex(rendu, r'^\d{2}/\d{2}/\d{4}$')

    def test_date_saisie_via_input_date(self):
        """Ce que le backend enregistre pour une saisie « 2026-07-21 » : minuit UTC."""
        self.assertEqual(_fmt_date(datetime(2026, 7, 21, 0, 0, tzinfo=dt_timezone.utc)),
                         '21/07/2026')

    def test_pas_de_bascule_de_jour_selon_le_fuseau(self):
        """Un horodatage aware est ramené en UTC : le jour affiché ne glisse jamais."""
        # Même instant, exprimé dans deux fuseaux différents.
        utc = datetime(2026, 7, 21, 0, 30, tzinfo=dt_timezone.utc)
        decale = utc.astimezone(dt_timezone(timedelta(hours=-5)))   # 2026-07-20 19:30 local
        self.assertEqual(_fmt_date(utc), '21/07/2026')
        self.assertEqual(_fmt_date(decale), '21/07/2026')

        fin_de_journee = datetime(2026, 7, 21, 23, 30, tzinfo=dt_timezone.utc)
        self.assertEqual(_fmt_date(fin_de_journee), '21/07/2026')

    def test_accepte_un_datetime_naif(self):
        self.assertEqual(_fmt_date(datetime(2026, 7, 21, 14, 5, 9)), '21/07/2026')

    def test_accepte_une_date_simple(self):
        self.assertEqual(_fmt_date(date(2026, 7, 21)), '21/07/2026')

    def test_valeur_absente(self):
        self.assertEqual(_fmt_date(None), '')
        self.assertEqual(_fmt_date(''), '')
