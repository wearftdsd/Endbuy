/** Miroir des bits de permission du serveur (affichage uniquement : le serveur reste l'autorité). */
export const P = {
  CREATE_INVITE: 1 << 0,
  KICK_MEMBERS: 1 << 1,
  BAN_MEMBERS: 1 << 2,
  ADMINISTRATOR: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_SERVER: 1 << 5,
  ADD_REACTIONS: 1 << 6,
  VIEW_CHANNEL: 1 << 7,
  SEND_MESSAGES: 1 << 8,
  MANAGE_MESSAGES: 1 << 9,
  ATTACH_FILES: 1 << 10,
  EMBED_LINKS: 1 << 11,
  READ_HISTORY: 1 << 12,
  MENTION_EVERYONE: 1 << 13,
  CONNECT: 1 << 14,
  SPEAK: 1 << 15,
  VIDEO: 1 << 16,
  MUTE_MEMBERS: 1 << 17,
  MANAGE_ROLES: 1 << 18,
  MANAGE_EMOJIS: 1 << 19,
  CHANGE_NICKNAME: 1 << 20,
  MANAGE_NICKNAMES: 1 << 21,
  REQUEST_TO_SPEAK: 1 << 22,
  MANAGE_EVENTS: 1 << 23,
} as const;

export const has = (perms: number | undefined, bit: number) => ((perms ?? 0) & bit) === bit;

export const PERMISSION_GROUPS: { title: string; items: { bit: number; name: string; desc: string; channel?: boolean }[] }[] = [
  {
    title: 'Permissions générales du serveur',
    items: [
      { bit: P.ADMINISTRATOR, name: 'Administrateur', desc: 'Accorde toutes les permissions et ignore les restrictions des salons. À donner avec prudence.' },
      { bit: P.MANAGE_SERVER, name: 'Gérer le serveur', desc: 'Modifier le nom, l’icône du serveur et gérer les invitations.' },
      { bit: P.MANAGE_ROLES, name: 'Gérer les rôles', desc: 'Créer, modifier et attribuer les rôles inférieurs au sien, et gérer les permissions des salons.', channel: true },
      { bit: P.MANAGE_CHANNELS, name: 'Gérer les salons', desc: 'Créer, modifier et supprimer des salons et catégories.', channel: true },
      { bit: P.MANAGE_EMOJIS, name: 'Gérer les emojis et stickers', desc: 'Ajouter ou supprimer les emojis et stickers personnalisés.' },
      { bit: P.MANAGE_EVENTS, name: 'Gérer les événements', desc: 'Créer, modifier, lancer et annuler des événements programmés.' },
      { bit: P.VIEW_CHANNEL, name: 'Voir les salons', desc: 'Voir les salons et lire les messages en direct.', channel: true },
    ],
  },
  {
    title: 'Membres',
    items: [
      { bit: P.CREATE_INVITE, name: 'Créer une invitation', desc: 'Inviter de nouvelles personnes sur le serveur.', channel: true },
      { bit: P.CHANGE_NICKNAME, name: 'Changer de pseudo', desc: 'Modifier son propre surnom sur ce serveur.' },
      { bit: P.MANAGE_NICKNAMES, name: 'Gérer les pseudos', desc: 'Modifier le surnom des autres membres.' },
      { bit: P.KICK_MEMBERS, name: 'Expulser des membres', desc: 'Retirer des membres du serveur (ils pourront revenir avec une invitation).' },
      { bit: P.BAN_MEMBERS, name: 'Bannir des membres', desc: 'Bannir définitivement des membres du serveur.' },
    ],
  },
  {
    title: 'Salons textuels',
    items: [
      { bit: P.SEND_MESSAGES, name: 'Envoyer des messages', desc: 'Écrire dans les salons textuels.', channel: true },
      { bit: P.EMBED_LINKS, name: 'Intégrer des liens', desc: 'Afficher un aperçu des liens partagés.', channel: true },
      { bit: P.ATTACH_FILES, name: 'Joindre des fichiers', desc: 'Envoyer des images, vidéos et fichiers.', channel: true },
      { bit: P.ADD_REACTIONS, name: 'Ajouter des réactions', desc: 'Réagir aux messages avec des emojis.', channel: true },
      { bit: P.MENTION_EVERYONE, name: 'Mentionner @everyone', desc: 'Notifier tous les membres avec @everyone et @here.', channel: true },
      { bit: P.MANAGE_MESSAGES, name: 'Gérer les messages', desc: 'Supprimer les messages des autres et épingler des messages.', channel: true },
      { bit: P.READ_HISTORY, name: "Voir l'historique", desc: 'Lire les messages envoyés avant son arrivée.', channel: true },
    ],
  },
  {
    title: 'Salons vocaux',
    items: [
      { bit: P.CONNECT, name: 'Se connecter', desc: 'Rejoindre les salons vocaux.', channel: true },
      { bit: P.SPEAK, name: 'Parler', desc: 'Parler dans les salons vocaux.', channel: true },
      { bit: P.VIDEO, name: 'Vidéo et partage d’écran', desc: 'Activer sa caméra ou partager son écran.', channel: true },
      { bit: P.MUTE_MEMBERS, name: 'Rendre muet des membres', desc: 'Couper le micro des autres membres en vocal. Dans une conférence : gérer les orateurs.', channel: true },
      { bit: P.REQUEST_TO_SPEAK, name: 'Demander la parole', desc: 'Lever la main pour parler dans un salon de conférence.', channel: true },
    ],
  },
];
