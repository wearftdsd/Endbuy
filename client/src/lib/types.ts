export interface Premium {
  plan: string;
  name?: string;
  since: string | null;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  avatarPreset: number;
  banner: string | null;
  bannerColor: string | null;
  accentColor: string | null;
  profileTheme: { primary: string; secondary: string } | null;
  bio: string;
  pronouns: string;
  premium: Premium | null;
  badges: string[];
  createdAt: string | null;
  deleted?: boolean;
}

export interface Settings {
  locale: 'fr' | 'en';
  theme: string;
  accent: string;
  fontScale: number;
  compact: boolean;
  reducedMotion: boolean;
  dmPrivacy: 'everyone' | 'friends' | 'none';
  friendRequests: 'everyone' | 'mutual' | 'none';
  notifications: { desktop: boolean; sounds: boolean; mentionsOnly: boolean; dmNotifications: boolean };
  showActivity: boolean;
  motion: boolean;
}

export interface Limits {
  premium: boolean;
  maxUploadBytes: number;
  maxAvatarBytes: number;
  maxBannerBytes: number;
  maxMessageLength: number;
  maxFilesPerMessage: number;
  animatedAvatar: boolean;
  customBanner: boolean;
  profileThemes: boolean;
  emojisEverywhere: boolean;
  stickersEverywhere: boolean;
  exclusiveThemes: boolean;
  audioBitrate: number;
  video: Quality;
  screen: Quality;
}

export interface Quality {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export type Status = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface SelfUser extends User {
  status: Status;
  customStatus: string;
  customStatusEmoji: string | null;
  totpEnabled: boolean;
  settings: Settings;
  limits: Limits;
}

export interface Role {
  id: string;
  name: string;
  color: string | null;
  permissions: number;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  isDefault: boolean;
}

export interface Overwrite {
  id: string;
  type: 'role' | 'member';
  allow: number;
  deny: number;
}

export const CH = { TEXT: 0, DM: 1, VOICE: 2, GROUP_DM: 3, CATEGORY: 4, STAGE: 5 } as const;
export const isVoiceLike = (type: number | undefined) => type === CH.VOICE || type === CH.STAGE;

export interface Channel {
  id: string;
  serverId: string | null;
  type: number;
  name: string;
  topic: string;
  parentId: string | null;
  position: number;
  userLimit: number;
  lastMessageId: string | null;
  ownerId: string | null;
  icon: string | null;
  permissions?: number;
  overwrites?: Overwrite[];
  recipients?: string[];
  closed?: boolean;
}

export interface Member {
  userId: string;
  nickname: string | null;
  roles: string[];
  joinedAt: string;
}

export interface Emoji {
  id: string;
  name: string;
  kind: 'emoji' | 'sticker';
  url: string;
  animated: boolean;
}

export interface Server {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  description: string;
  ownerId: string;
  createdAt: string;
  permissions: number;
  roles: Role[];
  channels: Channel[];
  members: Member[];
  emojis: Emoji[];
  events: ServerEvent[];
}

export const EV = { SCHEDULED: 1, ACTIVE: 2, COMPLETED: 3, CANCELED: 4 } as const;

export interface ServerEvent {
  id: string;
  serverId: string;
  creatorId: string | null;
  channelId: string | null;
  location: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  status: number;
  interestedIds: string[];
  createdAt: string;
}

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  size: number;
  contentType: string;
}

export interface Embed {
  type: 'link' | 'image' | 'video';
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  color?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface Message {
  id: string;
  channelId: string;
  author: User | null;
  content: string;
  type: number;
  replyToId: string | null;
  replyTo: { id: string; content: string; author: User | null } | null;
  sticker: { id: string; name: string; url: string; animated: boolean } | null;
  attachments: Attachment[];
  reactions: Reaction[];
  embeds: Embed[];
  pinned: boolean;
  mentions: string[];
  mentionEveryone: boolean;
  editedAt: string | null;
  createdAt: string;
}

export interface Presence {
  status: Status;
  customStatus: string;
  customStatusEmoji: string | null;
}

export interface VoiceState {
  userId: string;
  channelId: string;
  serverId: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  video: boolean;
  screen: boolean;
  suppress: boolean;
  speaker: boolean;
  requestToSpeak: number | null;
  joinedAt: number;
}

export interface Relationship {
  id: string;
  type: 1 | 2 | 3 | 4;
  since: string;
}

export interface ReadState {
  lastReadId: string | null;
  mentionCount: number;
}

export interface Ready {
  user: SelfUser;
  sessionId: string;
  servers: Server[];
  users: User[];
  presences: Record<string, Presence>;
  privateChannels: Channel[];
  relationships: Relationship[];
  readStates: Record<string, ReadState>;
  voiceStates: VoiceState[];
  rtc: { iceServers: RTCIceServer[] };
}
