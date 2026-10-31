/* Réact+ : logique de l'interface
 *
 *  1. Configuration      seuils, dimensions, couleurs
 *  2. Données            capteur et satellite (démonstration)
 *  3. Utilitaires        sélecteur, formats
 *  4. Graphiques         courbes, écart, statistiques, survol
 *  5. Mesures            cartes « dernières mesures »
 *  6. Décisions          règles d'irrigation et de chaleur
 *  7. NASA POWER         chargement des données en direct
 *  8. Démarrage
 */
"use strict";

/* ========== 1. CONFIGURATION ========== */

const N = 14; // nombre de jours affichés
const SEUIL_SOL = 70; // % : humidité du sol au-dessus de laquelle le riz n'a pas besoin d'eau
const SEUIL_CHALEUR = 35; // °C : seuil indicatif de stress du riz à la floraison
const MARGE_SURVEILLANCE = 4; // °C : sous cette marge, la chaleur est à surveiller
// Coordonnées de Kara utilisées pour demander le point météo correspondant à la parcelle.
const KARA = { lat: 9.55, lon: 1.19 };

const MOIS = ["jan", "fév", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

const COULEURS = {
  capteur: "#10B981",
  satellite: "#F59E0B",
  negatif: "#EF4444",
  grille: "#2D3748",
  zero: "#9CA3AF",
  texte: "#E5E7EB",
};

// Dimensions des graphiques (unités du viewBox SVG)
const GRAPHE = { largeur: 720, hauteur: 290, gauche: 48, droite: 16, haut: 30, bas: 30 };
const ECART = { hauteur: 140, haut: 16, bas: 28, largeurBarre: 26 };
const JOURS_AFFICHES = [0, 3, 6, 9, 13]; // indices des dates écrites sous l'axe

/* ========== 2. DONNÉES (démonstration) ========== */

// capteur = mesure sur la parcelle, satellite = mesure de la maille NASA
const DONNEES = {
  hum: {
    nom: "Humidité du sol",
    sat: "SMAP",
    unite: " %",
    uniteEcart: " pts",
    pas: 10,
    dec: 0,
    capteur: [74, 76, 79, 81, 80, 83, 82, 79, 77, 80, 84, 86, 84, 82],
    satellite: [58, 60, 63, 65, 64, 66, 66, 62, 60, 63, 67, 69, 67, 65],
  },
  temp: {
    nom: "Température",
    sat: "POWER",
    unite: " °C",
    uniteEcart: " °C",
    pas: 1,
    dec: 1,
    capteur: [29.1, 30.2, 31.0, 30.6, 29.8, 30.9, 32.1, 31.4, 30.2, 29.5, 30.8, 31.7, 32.4, 31.9],
    satellite: [28.2, 29.0, 29.8, 29.9, 29.1, 29.8, 30.7, 30.5, 29.4, 28.9, 29.6, 30.3, 31.0, 30.6],
  },
  rain: {
    nom: "Pluie",
    sat: "GPM",
    unite: " mm",
    uniteEcart: " mm",
    pas: 5,
    dec: 0,
    capteur: [0, 6, 14, 2, 0, 0, 8, 22, 4, 0, 0, 5, 12, 0],
    satellite: [1, 4, 11, 3, 0, 0, 6, 15, 5, 1, 0, 3, 9, 1],
  },
};

// Valeurs partagées par les graphiques et leur infobulle; les dates changent après le chargement NASA.
const etat = {
  dates: Array.from({ length: N }, (_, i) => `${18 + i} oct`),
  enDirect: false, // true une fois les données POWER chargées
};

/* ========== 3. UTILITAIRES ========== */

const $ = (sel) => document.querySelector(sel);

// 31.9 -> "31,9"
const fmt = (v, dec = 0) => v.toFixed(dec).replace(".", ",");

// 3 -> "+3", -3 -> "−3", 0 -> "0"
const signe = (v, dec = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), dec);

/* ========== 4. GRAPHIQUES ========== */

// Les fonctions suivantes calculent les positions SVG puis assemblent le HTML injecté dans #charts.

/* --- Géométrie --- */

const posX = (i) => GRAPHE.gauche + ((GRAPHE.largeur - GRAPHE.gauche - GRAPHE.droite) * i) / (N - 1);

const posY = (v, m) => GRAPHE.haut + (GRAPHE.hauteur - GRAPHE.haut - GRAPHE.bas) * (1 - (v - m.min) / (m.max - m.min));

const points = (serie, m) => serie.map((v, i) => `${posX(i)},${posY(v, m)}`).join(" ");

const etiquettesX = (y) =>
  JOURS_AFFICHES.map((i) => `<text x="${posX(i)}" y="${y}" text-anchor="middle">${etat.dates[i]}</text>`).join("");

/* --- Calculs --- */

// Fixe les bornes de l'axe vertical sur les deux séries
function calculerAxe(m) {
  const toutes = [...m.capteur, ...m.satellite];
  m.min = Math.floor(Math.min(...toutes) / m.pas) * m.pas;
  m.max = Math.ceil(Math.max(...toutes) / m.pas) * m.pas;
  if (m.max === m.min) m.max += m.pas;
}

// Écart capteur moins satellite, jour par jour
function analyserEcart(m) {
  const valeurs = m.capteur.map((v, i) => v - m.satellite[i]);
  return {
    valeurs,
    moyenne: valeurs.reduce((a, b) => a + b) / N,
    iMax: valeurs.reduce((best, v, i) => (Math.abs(v) > Math.abs(valeurs[best]) ? i : best), 0),
    joursAuDessus: valeurs.filter((v) => v > 0).length,
  };
}

/* --- Briques SVG du graphique principal --- */

function svgMotifEcart(id) {
  return `<defs>
    <pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="${COULEURS.satellite}" fill-opacity=".12"/>
      <line y2="6" stroke="${COULEURS.texte}" stroke-opacity=".35" stroke-width="1.6"/>
    </pattern>
  </defs>`;
}

function svgGrille(m) {
  let html = "";
  for (let v = m.min; v <= m.max + 1e-9; v += m.pas) {
    const y = posY(v, m);
    html += `<line x1="${GRAPHE.gauche}" x2="${GRAPHE.largeur - GRAPHE.droite}" y1="${y}" y2="${y}" stroke="${COULEURS.grille}"/>`;
    html += `<text x="${GRAPHE.gauche - 8}" y="${y + 4}" text-anchor="end">${Math.round(v * 10) / 10}</text>`;
  }
  return html;
}

// Zone hachurée entre les deux courbes : le contour suit le capteur, puis revient par le satellite
function svgZoneEcart(m, id) {
  const retour = m.satellite
    .map((v, i) => `${posX(i)},${posY(v, m)}`)
    .reverse()
    .join(" ");
  return `<polygon points="${points(m.capteur, m)} ${retour}" fill="url(#${id})"/>`;
}

function svgCourbes(m) {
  const trait = (serie, couleur) =>
    `<polyline points="${points(serie, m)}" fill="none" stroke="${couleur}" stroke-width="3" stroke-linejoin="round"/>`;
  const pastilles = m.capteur
    .map(
      (v, i) =>
        `<circle cx="${posX(i)}" cy="${posY(v, m)}" r="3.5" fill="${COULEURS.capteur}"/>` +
        `<circle cx="${posX(i)}" cy="${posY(m.satellite[i], m)}" r="3.5" fill="${COULEURS.satellite}"/>`,
    )
    .join("");
  return trait(m.satellite, COULEURS.satellite) + trait(m.capteur, COULEURS.capteur) + pastilles;
}

// Trait vertical et valeur sur le jour où l'écart est le plus grand
function svgMarqueurEcart(m, iMax, ecart) {
  const x = posX(iMax);
  const yHaut = posY(m.capteur[iMax], m);
  const yBas = posY(m.satellite[iMax], m);
  return (
    `<line x1="${x}" x2="${x}" y1="${yHaut}" y2="${yBas}" stroke="${COULEURS.texte}" stroke-width="2" stroke-dasharray="4 3"/>` +
    `<text x="${x}" y="${Math.min(yHaut, yBas) - 10}" text-anchor="middle" font-weight="700" fill="${COULEURS.texte}">${signe(ecart, m.dec)}</text>`
  );
}

function svgPrincipal(cle, m, a) {
  const id = `h-${cle}`;
  return `<svg class="main" viewBox="0 0 ${GRAPHE.largeur} ${GRAPHE.hauteur}" role="img" aria-label="Courbes capteur et ${m.sat}, ${m.nom}">
    ${svgMotifEcart(id)}
    ${svgGrille(m)}
    ${svgZoneEcart(m, id)}
    ${svgCourbes(m)}
    ${svgMarqueurEcart(m, a.iMax, a.valeurs[a.iMax])}
    <line class="cur" y1="${GRAPHE.haut}" y2="${GRAPHE.hauteur - GRAPHE.bas}" style="display:none"/>
    ${etiquettesX(GRAPHE.hauteur - 8)}
  </svg>`;
}

/* --- Graphique de l'écart (barres) --- */

function svgBarresEcart(a) {
  const demi = (ECART.hauteur - ECART.haut - ECART.bas) / 2;
  const zero = ECART.haut + demi;
  const maxAbs = Math.ceil(Math.max(...a.valeurs.map(Math.abs))) || 1;

  const barres = a.valeurs
    .map((v, i) => {
      const h = Math.max((Math.abs(v) / maxAbs) * demi, 1);
      const y = v >= 0 ? zero - h : zero;
      const couleur = v >= 0 ? COULEURS.capteur : COULEURS.negatif;
      return `<rect x="${posX(i) - ECART.largeurBarre / 2}" y="${y}" width="${ECART.largeurBarre}" height="${h}" rx="2" fill="${couleur}"/>`;
    })
    .join("");

  const x = GRAPHE.gauche - 8;
  const echelle =
    `<text x="${x}" y="${ECART.haut + 4}" text-anchor="end">${signe(maxAbs)}</text>` +
    `<text x="${x}" y="${zero + 4}" text-anchor="end">0</text>` +
    `<text x="${x}" y="${ECART.hauteur - ECART.bas + 4}" text-anchor="end">${signe(-maxAbs)}</text>`;

  return `<svg viewBox="0 0 ${GRAPHE.largeur} ${ECART.hauteur}" role="img" aria-label="Écart capteur moins satellite">
    ${echelle}
    <line x1="${GRAPHE.gauche}" x2="${GRAPHE.largeur - GRAPHE.droite}" y1="${zero}" y2="${zero}" stroke="${COULEURS.zero}"/>
    ${barres}
    ${etiquettesX(ECART.hauteur - 6)}
  </svg>`;
}

/* --- Bloc complet d'une mesure --- */

const htmlLegende = (m) => `
  <div class="legend">
    <span class="k s">Capteur de la parcelle</span>
    <span class="k g">${m.sat} (satellite)</span>
    <span class="k h">Écart entre les deux</span>
  </div>`;

const htmlStatistiques = (m, a) => `
  <dl class="stats">
    <div><dt>Écart moyen</dt><dd>${signe(a.moyenne, m.dec)}${m.uniteEcart}</dd></div>
    <div><dt>Jour le plus éloigné</dt><dd>${etat.dates[a.iMax]} : ${signe(a.valeurs[a.iMax], m.dec)}${m.uniteEcart}</dd></div>
    <div><dt>Jours capteur au-dessus</dt><dd>${a.joursAuDessus} sur ${N}</dd></div>
  </dl>`;

function blocGraphique(cle) {
  const m = DONNEES[cle];
  calculerAxe(m);
  const a = analyserEcart(m);
  const sens = a.moyenne >= 0 ? "plus" : "moins";

  return `<div class="chart c-${cle}">
    ${htmlLegende(m)}
    <div class="plot">${svgPrincipal(cle, m, a)}<div class="tip"></div></div>
    <p class="cap">Écart : capteur moins satellite. En vert, le capteur mesure plus ; en rouge, moins.</p>
    <div class="plot">${svgBarresEcart(a)}</div>
    ${htmlStatistiques(m, a)}
    <p class="read">Le capteur mesure ${sens} que ${m.sat} en moyenne : il voit la parcelle, le satellite voit une maille entière.</p>
  </div>`;
}

/* --- Infobulle au survol --- */

function activerSurvol(svg, cle) {
  const curseur = svg.querySelector(".cur");
  const bulle = svg.parentNode.querySelector(".tip");

  svg.addEventListener("pointermove", (e) => {
    const m = DONNEES[cle];
    const rect = svg.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) / rect.width) * GRAPHE.largeur;
    const i = Math.max(
      0,
      Math.min(
        N - 1,
        Math.round(((xSvg - GRAPHE.gauche) / (GRAPHE.largeur - GRAPHE.gauche - GRAPHE.droite)) * (N - 1)),
      ),
    );
    const ecart = m.capteur[i] - m.satellite[i];

    curseur.setAttribute("x1", posX(i));
    curseur.setAttribute("x2", posX(i));
    curseur.style.display = "";

    bulle.innerHTML =
      `<b>${etat.dates[i]}</b><br>Capteur ${fmt(m.capteur[i], m.dec)}${m.unite}` +
      `<br>${m.sat} ${fmt(m.satellite[i], m.dec)}${m.unite}` +
      `<br>Écart ${signe(ecart, m.dec)}${m.uniteEcart}`;
    bulle.style.display = "block";
    bulle.style.left = Math.min(Math.max((posX(i) / GRAPHE.largeur) * rect.width, 60), rect.width - 60) + "px";
  });

  svg.addEventListener("pointerleave", () => {
    curseur.style.display = "none";
    bulle.style.display = "none";
  });
}

function afficherGraphiques() {
  // Construit les trois mesures, puis n'affiche que celle choisie par les radios m-hum/m-temp/m-rain.
  const cles = Object.keys(DONNEES);
  $("#charts").innerHTML = cles.map(blocGraphique).join("");
  document.querySelectorAll(".plot svg.main").forEach((svg, i) => activerSurvol(svg, cles[i]));

  $("#sub").textContent = etat.enDirect
    ? `Parcelle de riz, Kara · satellite : NASA POWER en direct, du ${etat.dates[0]} au ${etat.dates[N - 1]} · capteur de démonstration`
    : "Parcelle de riz, Kara · du 18 au 31 octobre · données de démonstration";
}

/* ========== 5. MESURES ========== */

function afficherMesures() {
  // Produit les tuiles de résumé qui remplacent le conteneur vide #reads dans index.html.
  const cartes = [
    ["hum", "Humidité du sol"],
    ["temp", "Température"],
    ["rain", "Pluie du jour"],
  ];
  $("#reads").innerHTML = cartes
    .map(([cle, titre]) => {
      const m = DONNEES[cle];
      const capteur = m.capteur[N - 1];
      const satellite = m.satellite[N - 1];
      return `<div class="metric-box">
        <span class="metric-label">${titre} (capteur)</span>
        <div class="metric-value">${fmt(capteur, m.dec)}<span class="metric-unit">${m.unite}</span></div>
        <span class="metric-source">${m.sat} ${fmt(satellite, m.dec)}${m.unite} · écart ${signe(capteur - satellite, m.dec)}${m.uniteEcart}</span>
      </div>`;
    })
    .join("");
}

/* ========== 6. DÉCISIONS ========== */

/* --- Règles (sans accès à la page) --- */

function decisionIrrigation(sol, pluieDemain) {
  // Décide uniquement à partir du seuil d'humidité et de la pluie prévue, sans manipuler le DOM.
  if (sol > SEUIL_SOL) {
    return pluieDemain ? "Ne pas irriguer demain." : "Pas d’irrigation aujourd’hui, à revérifier demain.";
  }
  return pluieDemain ? "Irriguer peu : la pluie va compléter." : "Irriguer demain.";
}

function niveauChaleur(marge) {
  // Retourne le texte et la classe CSS de l'alerte selon la distance au seuil de chaleur.
  if (marge <= 0) return { titre: "Stress thermique : agir.", classe: " danger" };
  if (marge <= MARGE_SURVEILLANCE) return { titre: "Chaleur à surveiller.", classe: " warning" };
  return { titre: "Pas de stress thermique.", classe: "" };
}

/* --- Affichage --- */

function afficherDecision() {
  // Lit les contrôles HTML, recalcule les décisions et met à jour les éléments repérés par leurs ID.
  const sol = +$("#in-sol").value;
  const temp = +$("#in-t").value;
  const pluieDemain = $("#in-pl").checked;
  const tempSatellite = DONNEES.temp.satellite[N - 1];
  const pluieHier = DONNEES.rain.satellite[N - 2];
  const marge = SEUIL_CHALEUR - temp;
  const chaleur = niveauChaleur(marge);

  $("#o-sol").textContent = `${sol} %`;
  $("#o-t").textContent = `${fmt(temp, 1)} °C`;

  // Irrigation
  $("#a-irr").className = "alert-card" + (sol > SEUIL_SOL ? "" : " warning");
  $("#dd").textContent = decisionIrrigation(sol, pluieDemain);
  $("#g1").style.width = `${sol}%`;
  $("#why").innerHTML =
    `<li><b>Capteur :</b> le sol est à ${sol} %, ${sol > SEUIL_SOL ? "au-dessus du" : "sous le"} seuil de ${SEUIL_SOL} % pour le riz.</li>` +
    `<li><b>${DONNEES.rain.sat} :</b> ${fmt(pluieHier)} mm de pluie hier.</li>` +
    `<li><b>Prévision :</b> ${pluieDemain ? "de la pluie est annoncée demain." : "aucune pluie annoncée demain."}</li>`;
  $("#rule").textContent =
    `Règle : sol > ${SEUIL_SOL} % et pluie demain, donc pas d’irrigation. ` +
    `Sol à ${sol} % : ${sol > SEUIL_SOL ? "vrai" : "faux"}. Pluie demain : ${pluieDemain ? "vrai" : "faux"}. ` +
    `L’IA rédige la phrase ; les seuils décident.`;

  // Chaleur
  $("#a-st").className = "alert-card" + chaleur.classe;
  $("#h-st").textContent = chaleur.titre;
  $("#g2").style.width = Math.max(0, Math.min(100, (temp - 20) * 5)) + "%";
  $("#p-st").innerHTML =
    `<b>Capteur :</b> ${fmt(temp, 1)} °C, soit ${signe(temp - tempSatellite, 1)} °C par rapport à ${DONNEES.temp.sat} (${fmt(tempSatellite, 1)} °C). ` +
    (marge > 0 ? `Marge de ${fmt(marge, 1)} °C avant le` : `Dépassement de ${fmt(-marge, 1)} °C du`) +
    ` seuil indicatif de stress à la floraison (${SEUIL_CHALEUR} °C).`;
}

/* ========== 7. NASA POWER (données en direct) ========== */

// POWER publie avec quelques jours de retard : on s'arrête à J-4
function urlPower() {
  // Construit l'URL de l'API quotidienne NASA POWER pour Kara et les 14 derniers jours publiés.
  const jour = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const fin = new Date(Date.now() - 4 * 864e5);
  const debut = new Date(fin - (N - 1) * 864e5);
  return (
    "https://power.larc.nasa.gov/api/temporal/daily/point" +
    "?parameters=T2M,PRECTOTCORR,GWETTOP&community=AG" +
    `&longitude=${KARA.lon}&latitude=${KARA.lat}&start=${jour(debut)}&end=${jour(fin)}&format=JSON`
  );
}

// Vérifie la réponse et la convertit en séries ; lève une erreur si elle est incomplète
function lirePower(json) {
  const p = json.properties.parameter;
  const jours = Object.keys(p.T2M);
  const manquant = jours.some((j) => p.T2M[j] < -900 || p.PRECTOTCORR[j] < -900 || p.GWETTOP[j] < -900);
  if (jours.length !== N || manquant) throw new Error("données POWER incomplètes");

  return {
    dates: jours.map((j) => `${+j.slice(6)} ${MOIS[+j.slice(4, 6) - 1]}`),
    temp: jours.map((j) => p.T2M[j]),
    pluie: jours.map((j) => p.PRECTOTCORR[j]),
    humidite: jours.map((j) => p.GWETTOP[j] * 100),
  };
}

function appliquerPower(serie) {
  // Remplace les seules séries satellite; les mesures du capteur restent des données de démonstration.
  DONNEES.temp.satellite = serie.temp;
  DONNEES.rain.satellite = serie.pluie;
  DONNEES.hum.satellite = serie.humidite;
  for (const m of Object.values(DONNEES)) m.sat = "POWER";
  etat.dates = serie.dates;
  etat.enDirect = true;
}

async function chargerNasa() {
  // Gère l'état du bouton et du message HTML pendant la requête, puis rafraîchit l'interface en cas de succès.
  const bouton = $("#live");
  const message = $("#msg");
  bouton.disabled = true;
  message.textContent = "Chargement des données NASA POWER…";

  try {
    const reponse = await fetch(urlPower());
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    appliquerPower(lirePower(await reponse.json()));
    message.textContent = "Données NASA POWER chargées. Le capteur reste fictif.";
    afficherTout();
  } catch {
    message.textContent =
      "NASA POWER indisponible (réseau ou données pas encore publiées). Les données de démonstration restent affichées.";
  }
  bouton.disabled = false;
}

/* ========== 8. DÉMARRAGE ========== */

function afficherTout() {
  // Point de rafraîchissement commun après l'initialisation et le chargement des données en direct.
  afficherGraphiques();
  afficherMesures();
  afficherDecision();
}

function demarrer() {
  // Initialise les valeurs des commandes et relie leurs événements aux fonctions de mise à jour.
  // Les curseurs partent des dernières mesures du capteur
  $("#in-sol").value = DONNEES.hum.capteur[N - 1];
  $("#in-t").value = DONNEES.temp.capteur[N - 1];

  ["#in-sol", "#in-t", "#in-pl"].forEach((sel) => $(sel).addEventListener("input", afficherDecision));
  $("#live").addEventListener("click", chargerNasa);

  afficherTout();
}

demarrer();
