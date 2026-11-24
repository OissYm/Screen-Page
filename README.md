# Screen Page

Un userscript minimaliste qui enregistre la page que tu regardes — **telle qu'elle est rendue dans ton navigateur**, après JavaScript et avec ta session — dans un fichier **Markdown** lisible par n'importe quelle IA (Claude, ChatGPT, Gemini…).

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

- **Download the page (.md)** — télécharge le fichier
- **Copy the page (Markdown)** — copie le contenu, à coller directement dans une conversation

Rien n'est ajouté à la page. Seule exception : *Userscripts* sur iOS n'a pas de menu de commandes, donc un petit bouton `↓` discret apparaît en bas à droite.

> Astuce : sur les pages à chargement progressif (scroll infini, commentaires…), fais défiler jusqu'en bas avant de capturer — seul ce qui est chargé est enregistré.

## Pourquoi du Markdown plutôt qu'une capture d'écran ?

| | Markdown | Image |
| --- | --- | --- |
| Fidélité du texte | exacte, caractère par caractère | OCR implicite, erreurs sur le petit texte |
| Liens / URL | conservés | perdus |
| Longue page | quelques Ko | réduite ou tronquée par l'IA, illisible |
| Coût en tokens | faible | élevé |
| Mise en page visuelle | perdue | conservée |

Le texte structuré gagne partout, sauf quand la question porte sur le *design* de la page. Dans ce cas, ajoute simplement la capture d'écran native du téléphone (« Pleine page » sur iOS, capture défilante sur Android) : elle est plus fidèle que tout ce qu'un script peut redessiner.

## Ce que contient le fichier

- **En-tête** : titre, URL, site, auteur, dates, description, langue, date de capture
- **Contenu visible dans l'ordre de lecture** : titres, paragraphes, listes, tableaux, blocs de code, citations, liens absolus, images (texte alternatif + URL), formules
- **État de la page** : valeurs des champs de formulaire, cases cochées, boutons
- **Régions** balisées (`<!-- nav -->`, `<!-- aside -->`, `<!-- footer -->`) pour distinguer le contenu de l'habillage
- Shadow DOM et iframes de même origine inclus
- **Données structurées** (JSON-LD) en annexe : prix, notes, auteurs… quand le site les fournit

Ignoré : scripts, styles, éléments cachés, pixels de suivi, iframes publicitaires.

## Confidentialité

Tout se passe dans ton navigateur : aucune requête réseau, aucune donnée envoyée. Les mots de passe et numéros de carte ne sont jamais exportés. Le reste de ce qui est affiché (y compris tes données de compte) se retrouve dans le fichier — relis avant de partager.
