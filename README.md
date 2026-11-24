# Screen Page

Un userscript minimaliste qui enregistre la page que tu regardes — **telle qu'elle est rendue dans ton navigateur**, après JavaScript et avec ta session — dans un fichier **Markdown** et/ou un **PDF image de toute la page**, lisibles par n'importe quelle IA (Claude, ChatGPT, Gemini…).

Utile quand un site bloque les IA, exige une connexion, ou construit son contenu en JavaScript : tu captures, tu envoies le `.md` dans la conversation, et l'IA a tout le contexte.

## Installation

1. Installe un gestionnaire de userscripts :
   - **Android** : [Tampermonkey](https://www.tampermonkey.net/) (Firefox, Edge, Kiwi…)
   - **iPhone / iPad** : [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) (gratuit, Safari) ou Tampermonkey
   - **Ordinateur** : Tampermonkey ou Violentmonkey
2. Ouvre ce lien et confirme l'installation :

   ### 👉 [Installer Screen Page](https://raw.githubusercontent.com/OissYm/Screen-Page/HEAD/screen-page.user.js)

## Utilisation

Ouvre le menu de l'extension (son icône indique que le script est actif sur la page), puis :

- **Download the page (.md)** — le texte structuré de la page
- **Download the page as image (.pdf)** — la page entière en image, découpée en pages
- **Copy the page (Markdown)** — copie le texte, à coller directement dans une conversation

Rien n'est ajouté à la page. Seule exception : *Userscripts* sur iOS n'a pas de menu de commandes, donc un petit bouton `↓` discret apparaît en bas à droite et ouvre ces trois commandes.

Avant chaque capture, le script fait défiler la page une fois jusqu'en bas pour déclencher le contenu chargé à la demande (limité à 8 secondes pour les pages infinies).

Le mieux pour une IA : envoyer **les deux fichiers**. Le `.md` donne le texte exact et les liens ; le `.pdf` montre la mise en page, les graphiques et les couleurs.

### À propos du PDF

- La page est rendue en entier puis découpée en pages au format écran (100 pages max). Une seule image très haute serait réduite par l'IA jusqu'à devenir illisible.
- Le rendu est reconstruit par le script (le navigateur n'offre pas de vraie capture d'écran aux userscripts) : il peut différer légèrement de l'original, et les vidéos ou contenus d'autres sites intégrés (iframes) n'y figurent pas.
- Tampermonkey peut demander une fois l'autorisation d'accéder à d'autres domaines : elle sert uniquement à récupérer les images de la page hébergées ailleurs. Sans elle, ces images restent vides.

## Pourquoi du Markdown plutôt qu'une capture d'écran ?

| | Markdown | Image |
| --- | --- | --- |
| Fidélité du texte | exacte, caractère par caractère | OCR implicite, erreurs sur le petit texte |
| Liens / URL | conservés | perdus |
| Longue page | quelques Ko | réduite ou tronquée par l'IA, illisible |
| Coût en tokens | faible | élevé |
| Mise en page visuelle | perdue | conservée |

Le texte structuré gagne presque partout, mais il perd ce qui n'est porté que par le visuel : graphiques, couleurs, position des éléments. D'où le PDF image en complément.

## Ce que contient le fichier

- **En-tête** : titre, URL, site, auteur, dates, description, langue, date de capture
- **Contenu visible dans l'ordre de lecture** : titres, paragraphes, listes, tableaux, blocs de code, citations, liens absolus, images (texte alternatif + URL), formules
- **État de la page** : valeurs des champs de formulaire, cases cochées, boutons
- **Élément actif** : l'onglet ou l'option sélectionné est marqué `(selected)`, et un libellé stylé différemment de ses voisins (statut actif, valeur principale) est marqué `(highlighted)`
- **Graphiques SVG** : leurs libellés et valeurs (`[graphic: …]`)
- **Régions** balisées (`<!-- nav -->`, `<!-- aside -->`, `<!-- footer -->`) pour distinguer le contenu de l'habillage
- Shadow DOM et iframes de même origine inclus
- **Données structurées** (JSON-LD) en annexe : prix, notes, auteurs… quand le site les fournit

Ignoré : scripts, styles, éléments cachés, pixels de suivi, iframes publicitaires.

## Confidentialité

Tout se passe dans ton navigateur : rien n'est envoyé nulle part. Les seules requêtes sont celles du PDF, qui retélécharge les images et polices de la page pour les dessiner. Les mots de passe et numéros de carte ne sont jamais exportés. Le reste de ce qui est affiché (y compris tes données de compte) se retrouve dans le fichier — relis avant de partager.

## Crédits

Le rendu image utilise [modern-screenshot](https://github.com/qq15725/modern-screenshot) (licence MIT), inclus dans `vendor/`.
