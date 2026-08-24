# Dépendances épinglées, et pourquoi

Ce fichier existe parce que `package.json` n'accepte pas de commentaires, et
qu'un épinglage sans explication finit toujours par être retiré « puisqu'il ne
sert à rien ».

Les trois entrées de `pnpm.overrides` sont des correctifs de sécurité. Elles se
retirent le jour où la dépendance qui les impose publie une version qui embarque
déjà la version corrigée — pas avant, et jamais « pour voir ».

Contrôle : `npx pnpm audit --audit-level=low` doit répondre
« No known vulnerabilities found ».

## `sharp: ^0.35.3`

**Celui qui comptait vraiment.**

Le projet déclare sharp 0.35.3 en dépendance directe et s'en sert dans
`lib/sync/images.ts` pour normaliser les visuels importés. Mais Next embarquait
sa **propre** copie, en 0.34.5, vulnérable aux CVE de libvips
(CVE-2026-33327, -33328, -35590 et suivantes) — des défauts de décodage
d'image, c'est-à-dire exactement ce que fait cette copie-là.

Et elle le fait sur des images que nous ne choisissons pas : `next/image`
télécharge et décode les visuels distants côté serveur pour les optimiser. Une
image piégée hébergée chez notre fournisseur de médias, ou récupérée à
l'import, passait donc par une bibliothèque vulnérable — sans que le
`sharp` de notre `package.json`, lui, soit en cause.

L'override force les deux chemins sur la même version corrigée. Vérification :

```
node -e "console.log(require.resolve('sharp', {paths:['node_modules/next']}))"
```

doit désigner un répertoire `sharp@0.35.x`.

## `postcss: ^8.5.26`

Next embarquait postcss 8.4.31, vulnérable à quatre avis, dont trois variantes
d'une même faille : un `sourceMappingURL` contrôlé par l'entrée fait lire un
fichier `.map` arbitraire.

Le risque réel est faible ici — postcss ne tourne qu'à la construction, sur
notre propre CSS, qui n'est pas fourni par un tiers. L'override est retenu
quand même : il ne coûte rien, et le raisonnement « notre CSS n'est pas
hostile » cesse d'être vrai le jour où une feuille de style vient d'ailleurs.

## `deepmerge-ts: ^8.0.0`

Épuisement de pile sur des graphes d'objets récursifs, via
`prisma > @prisma/config`. Le chemin est celui du CLI Prisma : construction et
migrations, jamais l'application servie.

C'est un saut de version **majeur** imposé à une dépendance transitive de
Prisma, donc le seul des trois qui pouvait casser quelque chose. Vérifié après
coup : `prisma generate` et `prisma migrate status` fonctionnent. Si une
version future de Prisma s'en trouve gênée, c'est cet override qu'il faut
regarder en premier.
