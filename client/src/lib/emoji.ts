/** Jeu d'emojis Unicode intégré (aucune dépendance externe). Format : "emoji nom|emoji nom|…" */
const RAW: Record<string, string> = {
  Smileys:
    '😀 grinning|😃 smiley|😄 smile|😁 grin|😆 laughing|😅 sweat_smile|🤣 rofl|😂 joy|🙂 slightly_smiling|🙃 upside_down|😉 wink|😊 blush|😇 innocent|🥰 smiling_hearts|😍 heart_eyes|🤩 star_struck|😘 kissing_heart|😗 kissing|😚 kissing_closed_eyes|😋 yum|😛 stuck_out_tongue|😜 stuck_out_tongue_winking|🤪 zany|😝 squinting_tongue|🤑 money_mouth|🤗 hugging|🤭 hand_over_mouth|🤫 shushing|🤔 thinking|🤐 zipper_mouth|🤨 raised_eyebrow|😐 neutral|😑 expressionless|😶 no_mouth|😏 smirk|😒 unamused|🙄 rolling_eyes|😬 grimacing|😮‍💨 exhaling|🤥 lying|😌 relieved|😔 pensive|😪 sleepy|🤤 drooling|😴 sleeping|😷 mask|🤒 thermometer_face|🤕 head_bandage|🤢 nauseated|🤮 vomiting|🥵 hot|🥶 cold|🥴 woozy|😵 dizzy|🤯 exploding_head|🤠 cowboy|🥳 partying|😎 sunglasses|🤓 nerd|🧐 monocle|😕 confused|😟 worried|🙁 slightly_frowning|😮 open_mouth|😯 hushed|😲 astonished|😳 flushed|🥺 pleading|😦 frowning|😧 anguished|😨 fearful|😰 anxious|😥 sad_relieved|😢 cry|😭 sob|😱 scream|😖 confounded|😣 persevere|😞 disappointed|😓 sweat|😩 weary|😫 tired|🥱 yawning|😤 triumph|😡 rage|😠 angry|🤬 cursing|😈 smiling_imp|👿 imp|💀 skull|💩 poop|🤡 clown|👻 ghost|👽 alien|🤖 robot|😺 smiley_cat|😸 smile_cat|😹 joy_cat|😻 heart_eyes_cat|🙈 see_no_evil|🙉 hear_no_evil|🙊 speak_no_evil',
  Gestes:
    '👋 wave|🤚 raised_back_of_hand|✋ raised_hand|🖖 vulcan|👌 ok_hand|🤌 pinched_fingers|✌️ v|🤞 crossed_fingers|🤟 love_you|🤘 metal|🤙 call_me|👈 point_left|👉 point_right|👆 point_up|👇 point_down|☝️ point_up_2|👍 thumbsup|👎 thumbsdown|✊ fist|👊 punch|🤛 left_fist|🤜 right_fist|👏 clap|🙌 raised_hands|👐 open_hands|🤲 palms_up|🤝 handshake|🙏 pray|✍️ writing_hand|💅 nail_care|💪 muscle|🦾 mechanical_arm|👀 eyes|👁️ eye|🧠 brain|🫶 heart_hands|🫡 salute|🫠 melting',
  Coeurs:
    '❤️ heart|🧡 orange_heart|💛 yellow_heart|💚 green_heart|💙 blue_heart|💜 purple_heart|🖤 black_heart|🤍 white_heart|🤎 brown_heart|💔 broken_heart|❣️ heart_exclamation|💕 two_hearts|💞 revolving_hearts|💓 heartbeat|💗 heartpulse|💖 sparkling_heart|💘 cupid|💝 gift_heart|💟 heart_decoration|❤️‍🔥 heart_on_fire|💯 100|💢 anger|💥 boom|💫 dizzy_star|💦 sweat_drops|💨 dash|💬 speech_balloon|💭 thought_balloon|💤 zzz',
  Nature:
    '🐶 dog|🐱 cat|🐭 mouse|🐹 hamster|🐰 rabbit|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🐔 chicken|🐧 penguin|🐦 bird|🦆 duck|🦅 eagle|🦉 owl|🐺 wolf|🐴 horse|🦄 unicorn|🐝 bee|🦋 butterfly|🐌 snail|🐞 ladybug|🐢 turtle|🐍 snake|🐙 octopus|🦑 squid|🦀 crab|🐠 tropical_fish|🐬 dolphin|🐳 whale|🦈 shark|🐊 crocodile|🦖 t_rex|🐉 dragon|🌵 cactus|🎄 christmas_tree|🌲 evergreen|🌳 tree|🌴 palm_tree|🌱 seedling|🌿 herb|🍀 four_leaf_clover|🍁 maple_leaf|🍂 fallen_leaf|🌷 tulip|🌹 rose|🌺 hibiscus|🌸 cherry_blossom|🌼 blossom|🌻 sunflower|🌞 sun_with_face|🌝 full_moon_face|🌙 crescent_moon|⭐ star|🌟 star2|✨ sparkles|⚡ zap|🔥 fire|🌈 rainbow|☀️ sunny|⛅ partly_sunny|☁️ cloud|🌧️ rain|⛄ snowman|❄️ snowflake|🌊 ocean',
  Nourriture:
    '🍏 green_apple|🍎 apple|🍐 pear|🍊 tangerine|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🫐 blueberries|🍒 cherries|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥝 kiwi|🍅 tomato|🥑 avocado|🥦 broccoli|🌽 corn|🥕 carrot|🥐 croissant|🥖 baguette|🧀 cheese|🥚 egg|🍳 cooking|🥞 pancakes|🧇 waffle|🥓 bacon|🍗 poultry_leg|🌭 hotdog|🍔 hamburger|🍟 fries|🍕 pizza|🥪 sandwich|🌮 taco|🌯 burrito|🥗 salad|🍝 spaghetti|🍜 ramen|🍣 sushi|🍤 fried_shrimp|🍙 rice_ball|🍦 icecream|🍩 doughnut|🍪 cookie|🎂 birthday|🍰 cake|🧁 cupcake|🍫 chocolate_bar|🍬 candy|🍭 lollipop|🍿 popcorn|☕ coffee|🍵 tea|🧋 bubble_tea|🥤 cup_with_straw|🍺 beer|🍻 beers|🥂 champagne_glass|🍷 wine_glass|🍸 cocktail',
  Activités:
    '⚽ soccer|🏀 basketball|🏈 football|⚾ baseball|🎾 tennis|🏐 volleyball|🏉 rugby|🎱 8ball|🏓 ping_pong|🏸 badminton|🥊 boxing_glove|🥋 martial_arts|⛳ golf|⛸️ ice_skate|🎿 ski|🏂 snowboarder|🏆 trophy|🥇 first_place|🥈 second_place|🥉 third_place|🏅 medal|🎖️ military_medal|🎮 video_game|🕹️ joystick|🎲 game_die|🧩 jigsaw|♟️ chess_pawn|🎯 dart|🎳 bowling|🎨 art|🎬 clapper|🎤 microphone|🎧 headphones|🎼 musical_score|🎹 musical_keyboard|🥁 drum|🎷 saxophone|🎺 trumpet|🎸 guitar|🎻 violin|🎉 tada|🎊 confetti_ball|🎈 balloon|🎁 gift|🎀 ribbon|🪄 magic_wand',
  Objets:
    '⌚ watch|📱 iphone|💻 computer|⌨️ keyboard|🖥️ desktop|🖱️ mouse_three_button|💾 floppy_disk|💿 cd|📷 camera|📹 video_camera|🎥 movie_camera|📞 telephone_receiver|📺 tv|📻 radio|🔋 battery|🔌 electric_plug|💡 bulb|🔦 flashlight|🕯️ candle|💸 money_with_wings|💵 dollar|💶 euro|💰 moneybag|💳 credit_card|💎 gem|⚖️ scales|🔧 wrench|🔨 hammer|🛠️ tools|⚙️ gear|🔗 link|🔒 lock|🔓 unlock|🔑 key|🗝️ old_key|🛡️ shield|⚔️ crossed_swords|💣 bomb|🔮 crystal_ball|🧲 magnet|🧪 test_tube|🔭 telescope|📡 satellite|💊 pill|🩹 bandage|📦 package|📫 mailbox|✉️ envelope|📝 memo|📁 file_folder|📅 date|📌 pushpin|📎 paperclip|✂️ scissors|📚 books|📖 book|🔍 mag|🔔 bell|🔕 no_bell|📣 mega|📢 loudspeaker|🚀 rocket|✈️ airplane|🚗 car|🏠 house|🏰 castle|🗺️ world_map|⏰ alarm_clock|⏳ hourglass',
  Symboles:
    '✅ white_check_mark|☑️ ballot_box_with_check|✔️ heavy_check_mark|❌ x|❎ negative_squared_cross_mark|➕ heavy_plus_sign|➖ heavy_minus_sign|➗ heavy_division_sign|❓ question|❔ grey_question|❗ exclamation|❕ grey_exclamation|‼️ bangbang|⁉️ interrobang|⚠️ warning|🚫 no_entry_sign|⛔ no_entry|🔞 underage|♻️ recycle|🆗 ok|🆕 new|🆒 cool|🆓 free|🆙 up|🔝 top|🔜 soon|🔴 red_circle|🟠 orange_circle|🟡 yellow_circle|🟢 green_circle|🔵 blue_circle|🟣 purple_circle|⚫ black_circle|⚪ white_circle|🟥 red_square|🟩 green_square|🟦 blue_square|⬆️ arrow_up|⬇️ arrow_down|⬅️ arrow_left|➡️ arrow_right|🔄 arrows_counterclockwise|🔁 repeat|▶️ arrow_forward|⏸️ pause_button|⏹️ stop_button|🎵 musical_note|🎶 notes|💲 heavy_dollar_sign|©️ copyright|®️ registered|™️ tm|🔅 low_brightness|🔆 high_brightness|📶 signal_strength|🏳️ white_flag|🏴 black_flag|🏁 checkered_flag|🚩 triangular_flag|🏳️‍🌈 rainbow_flag|🇫🇷 flag_fr|🇧🇪 flag_be|🇨🇭 flag_ch|🇨🇦 flag_ca|🇺🇸 flag_us|🇬🇧 flag_gb|🇩🇪 flag_de|🇪🇸 flag_es|🇮🇹 flag_it|🇯🇵 flag_jp|🇲🇦 flag_ma|🇩🇿 flag_dz|🇹🇳 flag_tn|🇸🇳 flag_sn',
};

export interface EmojiEntry {
  char: string;
  name: string;
}

export const EMOJI_CATEGORIES: { name: string; emojis: EmojiEntry[] }[] = Object.entries(RAW).map(([name, raw]) => ({
  name,
  emojis: raw.split('|').map((pair) => {
    const idx = pair.indexOf(' ');
    return { char: pair.slice(0, idx), name: pair.slice(idx + 1) };
  }),
}));

export const ALL_EMOJIS: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
const BY_NAME = new Map(ALL_EMOJIS.map((e) => [e.name, e.char]));
BY_NAME.set('+1', '👍');
BY_NAME.set('-1', '👎');
BY_NAME.set('heart_eyes', '😍');
BY_NAME.set('lol', '😂');

export function emojiByName(name: string) {
  return BY_NAME.get(name);
}

export function searchEmojis(q: string, limit = 40): EmojiEntry[] {
  const query = q.toLowerCase();
  const starts = ALL_EMOJIS.filter((e) => e.name.startsWith(query));
  const contains = ALL_EMOJIS.filter((e) => !e.name.startsWith(query) && e.name.includes(query));
  return [...starts, ...contains].slice(0, limit);
}

const RECENT_KEY = 'endbuy.recentEmojis';
export function recentEmojis(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 24);
  } catch {
    return [];
  }
}
export function pushRecentEmoji(e: string) {
  try {
    const list = [e, ...recentEmojis().filter((x) => x !== e)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignoré */
  }
}

/** Remplace :nom: par l'emoji correspondant (unicode) ou <:nom:id> (emoji personnalisé). */
export function replaceShortcodes(text: string, custom: { id: string; name: string; animated: boolean }[]): string {
  const segments = text.split(/(```[\s\S]*?```|`[^`]*`)/g);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg.replace(/(^|[^<a-zA-Z0-9]):([a-zA-Z0-9_+-]{2,32}):/g, (full, pre, name) => {
        const c = custom.find((e) => e.name === name);
        if (c) return `${pre}<${c.animated ? 'a' : ''}:${c.name}:${c.id}>`;
        const u = BY_NAME.get(name);
        return u ? pre + u : full;
      });
    })
    .join('');
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '🎉'];
