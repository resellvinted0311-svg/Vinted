/**
 * L'adresse qu'un formulaire GET produirait s'il était soumis nativement.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi reproduire le navigateur au lieu de composer l'URL à sa façon
 * ---------------------------------------------------------------------------
 * Le panneau de filtres est un vrai formulaire GET, et il doit le rester : la
 * boutique fonctionne sans JavaScript, et c'est cette soumission native qui la
 * fait marcher là-bas. L'amélioration progressive ajoute par-dessus une
 * navigation côté client, qui évite de recharger tout le document.
 *
 * Les deux chemins doivent donc produire la MÊME adresse. S'ils divergeaient —
 * l'un gardant `prix_min=` vide, l'autre le retirant — on obtiendrait deux
 * adresses pour un même écran : deux entrées de cache, deux pages indexables,
 * et un partage de lien qui ne montre pas ce que la personne avait sous les
 * yeux. C'est le genre d'écart qui ne casse rien et que personne ne remarque.
 *
 * On reproduit donc fidèlement le comportement natif, y compris ce qu'il a
 * d'un peu bête : les champs vides sont transmis, parce qu'un navigateur les
 * transmet.
 *
 * ---------------------------------------------------------------------------
 * Pure, donc vérifiable
 * ---------------------------------------------------------------------------
 * Elle ne reçoit pas le formulaire mais son action et ses entrées. C'est ce
 * qui permet de la tester sans navigateur — et cette fonction est exactement
 * le genre d'endroit où une divergence se glisse sans bruit.
 */
export function formGetUrl(
  action: string,
  entries: Iterable<[string, FormDataEntryValue]>,
): string {
  const params = new URLSearchParams()

  for (const [nom, valeur] of entries) {
    // Un fichier n'a pas sa place dans une requête GET, et le navigateur ne
    // l'y met pas non plus : il n'enverrait que son nom, ce qui n'a aucun
    // sens ici. On l'écarte plutôt que de transmettre un « [object File] ».
    if (typeof valeur === 'string') params.append(nom, valeur)
  }

  const requete = params.toString()
  return requete === '' ? action : `${action}?${requete}`
}
