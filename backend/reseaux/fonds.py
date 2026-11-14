"""Catalogue des fonds de carte proposés par l'application (module Réseau GPS).

Seuls figurent des services **gratuits ou à accès gratuit** dont les conditions autorisent
l'affichage direct des tuiles avec attribution. Chaque entrée porte sa licence / ses
conditions, affichées à l'opérateur avant qu'il l'ajoute à « Mes fonds ».

Volontairement absent : **Google Maps / Google Satellite** — ses tuiles ne sont utilisables
qu'au travers des API Google Maps (clé, facturation, conditions) ; un opérateur qui en a
l'accès peut l'ajouter comme fond personnalisé.

Ajouter un fond = une entrée ici (identifiant stable : il est mémorisé dans les choix des
opérateurs). Les URL XYZ utilisent {z}/{x}/{y} (et {s} pour les sous-domaines a/b/c).
"""

CATEGORIES = [
    {'code': 'cartographique', 'libelle': 'Fonds cartographiques', 'icone': 'fas fa-map'},
    {'code': 'satellitaire', 'libelle': 'Images satellitaires et aériennes', 'icone': 'fas fa-satellite'},
    {'code': 'relief', 'libelle': 'Relief et topographie', 'icone': 'fas fa-mountain'},
    {'code': 'neutre', 'libelle': 'Fonds neutres (lisibilité du réseau)', 'icone': 'fas fa-palette'},
    {'code': 'wms', 'libelle': 'Services WMS', 'icone': 'fas fa-server'},
]

_OSM = '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
_ESRI = 'Tuiles &copy; Esri'
_LIC_OSM = 'ODbL — usage raisonnable des serveurs de tuiles OSM (pas de téléchargement massif).'
_LIC_ESRI = "Esri — affichage gratuit avec attribution (conditions d'utilisation ArcGIS Online)."

CATALOGUE = [
    # --- Cartographiques
    {'id': 'osm', 'nom': 'OpenStreetMap', 'categorie': 'cartographique', 'type': 'xyz',
     'url': 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 'max_zoom': 19,
     'attribution': _OSM, 'licence': _LIC_OSM,
     'description': 'Carte routière et toponymique de référence, mise à jour en continu.'},
    {'id': 'osm-fr', 'nom': 'OpenStreetMap France', 'categorie': 'cartographique', 'type': 'xyz',
     'url': 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', 'max_zoom': 20,
     'attribution': _OSM + ' — rendu OSM France', 'licence': _LIC_OSM,
     'description': 'Rendu francophone d\'OpenStreetMap (noms en français quand ils existent).'},
    {'id': 'osm-hot', 'nom': 'OpenStreetMap Humanitaire', 'categorie': 'cartographique', 'type': 'xyz',
     'url': 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', 'max_zoom': 19,
     'attribution': _OSM + ' — style HOT', 'licence': _LIC_OSM,
     'description': 'Style contrasté mettant en avant bâti, pistes et équipements.'},
    {'id': 'carto-voyager', 'nom': 'CARTO Voyager', 'categorie': 'cartographique', 'type': 'xyz',
     'url': 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', 'max_zoom': 20,
     'attribution': _OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>',
     'licence': 'CARTO — gratuit avec attribution (usage non massif).',
     'description': 'Carte claire et lisible, routes et toponymes discrets.'},
    {'id': 'esri-rues', 'nom': 'Esri World Street Map', 'categorie': 'cartographique', 'type': 'xyz',
     'url': 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
     'max_zoom': 19, 'attribution': _ESRI, 'licence': _LIC_ESRI,
     'description': 'Carte routière mondiale Esri.'},
    {'id': 'esri-natgeo', 'nom': 'Esri National Geographic', 'categorie': 'cartographique', 'type': 'xyz',
     'url': 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
     'max_zoom': 16, 'attribution': _ESRI + ' — National Geographic', 'licence': _LIC_ESRI,
     'description': 'Style atlas, relief estompé et toponymie.'},
    # --- Satellitaires
    {'id': 'esri-imagerie', 'nom': 'Esri World Imagery', 'categorie': 'satellitaire', 'type': 'xyz',
     'url': 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
     'max_zoom': 19, 'attribution': _ESRI + ' — Esri, Maxar, Earthstar Geographics', 'licence': _LIC_ESRI,
     'description': 'Imagerie satellite et aérienne haute résolution (jusqu\'à ~30 cm en zone urbaine).'},
    {'id': 'esri-clarity', 'nom': 'Esri World Imagery (Clarity)', 'categorie': 'satellitaire', 'type': 'xyz',
     'url': 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
     'max_zoom': 19, 'attribution': _ESRI + ' — Esri, Maxar, Earthstar Geographics', 'licence': _LIC_ESRI,
     'description': 'Variante « Clarity » de l\'imagerie Esri, souvent plus nette ou plus récente.'},
    {'id': 'eox-s2', 'nom': 'Sentinel-2 sans nuages (EOX, 2020)', 'categorie': 'satellitaire', 'type': 'xyz',
     'url': 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
     'max_zoom': 15,
     'attribution': 'Sentinel-2 cloudless — <a href="https://s2maps.eu">s2maps.eu</a> by EOX IT Services GmbH '
                    '(données Copernicus Sentinel 2020)',
     'licence': 'CC BY-NC-SA 4.0 — gratuit pour un usage non commercial.',
     'description': 'Mosaïque Sentinel-2 à 10 m sans nuages : vision d\'ensemble du terrain.'},
    # --- Relief
    {'id': 'opentopomap', 'nom': 'OpenTopoMap', 'categorie': 'relief', 'type': 'xyz',
     'url': 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', 'max_zoom': 17,
     'attribution': _OSM + ', SRTM — style &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
     'licence': 'CC-BY-SA — gratuit avec attribution.',
     'description': 'Carte topographique avec courbes de niveau et estompage.'},
    {'id': 'esri-topo', 'nom': 'Esri World Topographic', 'categorie': 'relief', 'type': 'xyz',
     'url': 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
     'max_zoom': 19, 'attribution': _ESRI, 'licence': _LIC_ESRI,
     'description': 'Carte topographique mondiale Esri.'},
    {'id': 'esri-estompage', 'nom': 'Esri Shaded Relief', 'categorie': 'relief', 'type': 'xyz',
     'url': 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
     'max_zoom': 13, 'attribution': _ESRI + ' — NaturalVue', 'licence': _LIC_ESRI,
     'description': 'Relief estompé seul : met en évidence crêtes et vallées (intervisibilité).'},
    # --- Neutres
    {'id': 'carto-clair', 'nom': 'CARTO Positron (clair)', 'categorie': 'neutre', 'type': 'xyz',
     'url': 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', 'max_zoom': 20,
     'attribution': _OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>',
     'licence': 'CARTO — gratuit avec attribution (usage non massif).',
     'description': 'Fond très clair : le réseau ressort au premier plan.'},
    {'id': 'carto-sombre', 'nom': 'CARTO Dark Matter (sombre)', 'categorie': 'neutre', 'type': 'xyz',
     'url': 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', 'max_zoom': 20,
     'attribution': _OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>',
     'licence': 'CARTO — gratuit avec attribution (usage non massif).',
     'description': 'Fond sombre, assorti au thème sombre de l\'application.'},
    {'id': 'esri-gris', 'nom': 'Esri Light Gray Canvas', 'categorie': 'neutre', 'type': 'xyz',
     'url': 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
     'max_zoom': 16, 'attribution': _ESRI, 'licence': _LIC_ESRI,
     'description': 'Fond gris neutre Esri.'},
    # --- WMS
    {'id': 'terrestris-osm', 'nom': 'OSM-WMS (terrestris)', 'categorie': 'wms', 'type': 'wms',
     'url': 'https://ows.terrestris.de/osm/service', 'couches': 'OSM-WMS', 'format': 'image/png',
     'max_zoom': 19, 'attribution': _OSM + ' — WMS &copy; terrestris',
     'licence': 'Service WMS public gratuit de terrestris (attribution requise).',
     'description': 'Exemple de service WMS : OpenStreetMap servi en WMS.'},
    {'id': 'terrestris-topo', 'nom': 'TOPO-WMS (terrestris)', 'categorie': 'wms', 'type': 'wms',
     'url': 'https://ows.terrestris.de/osm/service', 'couches': 'TOPO-WMS', 'format': 'image/png',
     'max_zoom': 19, 'attribution': _OSM + ', SRTM — WMS &copy; terrestris',
     'licence': 'Service WMS public gratuit de terrestris (attribution requise).',
     'description': 'Carte topographique (relief SRTM + OSM) en WMS.'},
]

FONDS_PAR_DEFAUT = ['osm', 'esri-imagerie', 'opentopomap', 'carto-clair']

AIDE_FOND_PERSONNALISE = [
    "Tuiles XYZ : l'URL contient {z} (zoom), {x} et {y} (colonne / ligne de la tuile), "
    "par ex. https://serveur.exemple/tuiles/{z}/{x}/{y}.png. Certains services inversent "
    "l'ordre ({z}/{y}/{x}, cas des services ArcGIS « MapServer/tile ») : recopiez l'URL "
    "telle que le fournisseur la publie. {s} désigne un sous-domaine (a, b ou c).",
    "WMS : saisissez l'URL du service sans paramètres (sans « ?SERVICE=WMS… ») et le nom "
    "de la ou des couches (paramètre LAYERS, séparées par des virgules). Le nom des couches "
    "figure dans la réponse GetCapabilities du service (URL?SERVICE=WMS&REQUEST=GetCapabilities). "
    "Le service doit accepter la projection Web Mercator (EPSG:3857).",
    "Vérifiez les conditions d'utilisation du fournisseur (clé d'accès, usage commercial, "
    "attribution à afficher) et renseignez l'attribution demandée.",
    "Exemples : orthophotos d'un géoportail régional ou de votre organisme (WMS), "
    "Google Satellite si vous disposez d'un accès autorisé par les API Google Maps.",
    "Les fonds personnalisés sont enregistrés dans votre navigateur.",
]
