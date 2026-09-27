const { Telegraf, Markup, Scenes, session } = require('telegraf');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

// ⚠️⚠️⚠️ SOZLAMALARNI TO'LDIRING ⚠️⚠️⚠️
// DIQQAT: Eski tokeningiz oshkor bo'lgan (chatga tashlangan), shuning uchun
// BotFather'da /revoke buyrug'i orqali ALBATTA yangi token oling!
// Tokenni endi shu faylga emas, ".env" fayliga yozasiz (BOT_TOKEN=...).
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN topilmadi! '.env' faylida BOT_TOKEN=... qatorini to'ldiring.");
  process.exit(1);
}
const ADMIN_ID = 6846408281; // Telegram ID'ingiz (son ko'rinishida)
const BAZA_CHANNEL_ID = '-1003985421760'; // Kinolar saqlanadigan yopiq kanal (ID)
const BAZA_CHANNEL_LINK = ''; // Yopiq kanalning taklif havolasi (https://t.me/+xxxxx). Bo'sh qoldirsangiz tugma ko'rsatilmaydi.
const MAIN_CHANNEL_ID = '@aerokino'; // Reklama/E'lonlar kanali (username bilan)
const BOT_USERNAME_OVERRIDE = 'aero_kino_bot'; // Caption'da ko'rsatiladigan username (@ belgisisiz). Bo'sh qoldirsangiz ("") bot avtomatik o'zining haqiqiy username'ini oladi.

const bot = new Telegraf(BOT_TOKEN);

// Kinolar bazasi fayli
const DB_FILE = './movies.json';
let movies = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE)) : {};

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(movies, null, 2));
}

// Majburiy obuna kanallari bazasi
const CHANNELS_FILE = './subchannels.json';
let subChannels = fs.existsSync(CHANNELS_FILE) ? JSON.parse(fs.readFileSync(CHANNELS_FILE)) : [];

function saveChannels() {
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(subChannels, null, 2));
}

// Foydalanuvchilar bazasi (xabar yuborish - broadcast uchun)
const USERS_FILE = './users.json';
let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : [];

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function addUser(id) {
  if (!users.includes(id)) {
    users.push(id);
    saveUsers();
  }
}

// Sevimlilar bazasi: { [userId]: [kod1, kod2, ...] }
const FAVORITES_FILE = './favorites.json';
let favorites = fs.existsSync(FAVORITES_FILE) ? JSON.parse(fs.readFileSync(FAVORITES_FILE)) : {};

function saveFavorites() {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2));
}

// Qo'shimcha adminlar bazasi (asosiy ADMIN_ID bundan tashqari, alohida saqlanadi)
const ADMINS_FILE = './admins.json';
let admins = fs.existsSync(ADMINS_FILE) ? JSON.parse(fs.readFileSync(ADMINS_FILE)) : [];

function saveAdmins() {
  fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2));
}

// Kinoning o'rtacha reytingi va baholar sonini hisoblaydi
function getRatingStats(movie) {
  const values = movie.ratings ? Object.values(movie.ratings) : [];
  if (!values.length) return { avg: 0, count: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { avg: sum / values.length, count: values.length };
}

// Keyingi bo'sh kodni topish (o'chirilgan kodlar takrorlanib qolmasligi uchun)
function getNextCode() {
  const nums = Object.keys(movies).map(Number).filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return String(max + 1);
}

// Kanal username/ID'dan to'g'ri havola yasash
function buildChannelLink(idOrUsername, fallbackLink) {
  if (fallbackLink) return fallbackLink;
  if (typeof idOrUsername === 'string' && idOrUsername.startsWith('@')) {
    return `https://t.me/${idOrUsername.slice(1)}`;
  }
  return null; // -100 bilan boshlanuvchi ID'dan ochiq link yasab bo'lmaydi
}

// Caption matnini yasovchi umumiy funksiya (qo'shishda ham, tahrirlashda ham ishlatiladi)
// partInfo: { current, total } — agar kino bir nechta qismdan iborat bo'lsa, qism raqami ko'rsatiladi
function buildCaption(code, data, botUsername, partInfo, ratingInfo) {
  const mainHashtag = `#kino${code}`;
  const genreHashtags = data.genre
    .split(',')
    .map((g) => `#${g.trim().replace(/\s+/g, '_')}`)
    .join(' ');

  let caption =
    `🎬 **${data.title}**\n\n` +
    `🌍 **Davlat:** ${data.country}\n` +
    `📅 **Yil:** ${data.year}\n` +
    `🎭 **Janr:** ${data.genre}\n\n`;

  if (partInfo && partInfo.total > 1) {
    caption += `🎞 **Qism:** ${partInfo.current}/${partInfo.total}\n\n`;
  }

  if (ratingInfo && ratingInfo.count > 0) {
    caption += `⭐ **Reyting:** ${ratingInfo.avg.toFixed(1)}/5 (${ratingInfo.count} ta baho)\n\n`;
  }

  caption += `🔑 **Kino kodi:** \`${code}\`\n\n` + `📌 ${mainHashtag} ${genreHashtags}`;

  return caption;
}

function isAdmin(ctx) {
  return ctx.from && isAdminId(ctx.from.id);
}

// Faqat asosiy (ADMIN_ID) — qo'shimcha adminlarni boshqarish huquqi faqat unga tegishli
function isOwner(ctx) {
  return ctx.from && ctx.from.id === ADMIN_ID;
}

function isAdminId(id) {
  return id === ADMIN_ID || admins.includes(id);
}

function getBotUsername(ctx) {
  return BOT_USERNAME_OVERRIDE || ctx.botInfo.username;
}

// Kinoning qismlar ro'yxatini qaytaradi. Eski (bitta videoli) yozuvlar bilan ham mos ishlaydi.
function getMovieParts(movie) {
  if (movie.parts && movie.parts.length) return movie.parts;
  if (movie.video_chat_id && movie.video_message_id) {
    return [{ part: 1, video_chat_id: movie.video_chat_id, video_message_id: movie.video_message_id }];
  }
  return [];
}

// Kino uchun to'liq inline klaviaturani yasaydi: qism tugmalari + baholash + sevimli + izohlar
function buildMovieKeyboard(userId, code, movie, part, parts) {
  const totalParts = parts.length;
  const channelLink = buildChannelLink(MAIN_CHANNEL_ID);
  const keyboard = [];

  // Agar bir nechta qism bo'lsa — qism tanlash tugmalari (5 tadan qatorda)
  if (totalParts > 1) {
    for (let i = 0; i < parts.length; i += 5) {
      keyboard.push(
        parts.slice(i, i + 5).map((p) => ({
          text: p.part === part.part ? `✅ ${p.part}` : `${p.part}`,
          callback_data: `moviepart_${code}_${p.part}`,
        }))
      );
    }
  }

  // Baholash tugmalari (1-5 yulduz). Foydalanuvchi avval bergan bahosi ✅ bilan belgilanadi.
  const myRating = movie.ratings ? movie.ratings[userId] : undefined;
  keyboard.push(
    [1, 2, 3, 4, 5].map((n) => ({
      text: myRating === n ? `✅${n}⭐` : `${n}⭐`,
      callback_data: `rate_${code}_${part.part}_${n}`,
    }))
  );

  // Sevimlilar va izohlar
  const isFav = (favorites[userId] || []).includes(code);
  const commentsCount = (movie.comments || []).length;
  keyboard.push([
    {
      text: isFav ? '💔 Sevimlilardan olib tashlash' : '❤️ Sevimlilarga qo\'shish',
      callback_data: `fav_${code}_${part.part}`,
    },
  ]);
  keyboard.push([{ text: `💬 Izohlar (${commentsCount})`, callback_data: `comments_${code}_${part.part}` }]);

  keyboard.push([{ text: '🔄 Do\'stlarga ulashish', switch_inline_query: code }]);
  if (channelLink) keyboard.push([{ text: '📢 Bizning kanal', url: channelLink }]);

  return keyboard;
}

// Berilgan kodli kinoning ma'lum bir qismini foydalanuvchiga yuborish
// (kod orqali qidirishda ham, deep-link orqali ham, qism tugmalari orqali ham ishlatiladi)
async function sendMoviePart(ctx, code, partNumber) {
  const movie = movies[code];
  if (!movie) {
    return ctx.reply('❌ *Bunday kodli kino topilmadi.*', { parse_mode: 'Markdown' });
  }

  const parts = getMovieParts(movie);
  if (!parts.length) {
    return ctx.reply('❌ Bu kino uchun video topilmadi.');
  }

  const part = parts.find((p) => p.part === partNumber) || parts[0];
  const totalParts = parts.length;
  const keyboard = buildMovieKeyboard(ctx.from.id, code, movie, part, parts);

  try {
    const sent = await ctx.telegram.copyMessage(ctx.chat.id, part.video_chat_id, part.video_message_id, {
      reply_markup: { inline_keyboard: keyboard },
    });

    // Caption'ni joriy reyting bilan yangilaymiz (kanaldagi statik caption emas, jonli ma'lumot uchun)
    try {
      const ratingInfo = getRatingStats(movie);
      const partInfo = totalParts > 1 ? { current: part.part, total: totalParts } : null;
      const freshCaption = buildCaption(code, movie, getBotUsername(ctx), partInfo, ratingInfo);
      await ctx.telegram.editMessageCaption(ctx.chat.id, sent.message_id, undefined, freshCaption, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (e) {
      // Caption yangilanmasa ham davom etaveramiz — bu kritik emas
    }
  } catch (e) {
    console.log('Yuborish xatoligi:', e);
    ctx.reply('❌ Videoni yuborishda xatolik yuz berdi.');
  }
}

// Kodni qabul qilib, birinchi qismni yuboradi (oddiy qidiruv va deep-link uchun)
async function sendMovieToUser(ctx, code) {
  return sendMoviePart(ctx, code, 1);
}

// ---------------------------------------------------------
// MAJBURIY OBUNA TEKSHIRUVI
// ---------------------------------------------------------
let mainChannelTitle = 'Asosiy kanalimiz';

function getMainChannelEntry() {
  return {
    id: MAIN_CHANNEL_ID,
    title: mainChannelTitle,
    link: buildChannelLink(MAIN_CHANNEL_ID),
  };
}

async function getUnsubscribedChannels(ctx) {
  const allChannels = [getMainChannelEntry(), ...subChannels];
  const unsub = [];
  for (const ch of allChannels) {
    try {
      const member = await ctx.telegram.getChatMember(ch.id, ctx.from.id);
      if (!['member', 'administrator', 'creator'].includes(member.status)) {
        unsub.push(ch);
      }
    } catch (e) {
      // Tekshirib bo'lmasa (masalan bot admin emas), xavfsizlik uchun obuna bo'lmagan deb hisoblaymiz
      unsub.push(ch);
    }
  }
  return unsub;
}

function buildSubscribeKeyboard(unsubChannels) {
  const rows = unsubChannels.map((ch) => [Markup.button.url(`📢 ${ch.title}`, ch.link)]);
  rows.push([Markup.button.callback('✅ Obunani tekshirish', 'check_subscription')]);
  return Markup.inlineKeyboard(rows);
}

// ---------------------------------------------------------
// KINO QO'SHISH WIZARD SCENE
// ---------------------------------------------------------
const addMovieWizard = new Scenes.WizardScene(
  'ADD_MOVIE_SCENE',

  async (ctx) => {
    ctx.wizard.state.movieData = {};
    await ctx.reply(
      "🎬 *Kino nomini kiriting:*\n(Masalan: _Qasoskorlar: Intihosi_)\n\n❌ Bekor qilish uchun /bekor yozing.",
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply("Iltimos, matn shaklida yuboring.");
    ctx.wizard.state.movieData.title = ctx.message.text;
    await ctx.reply("🌍 *Kino ishlab chiqarilgan davlatni kiriting:*\n(Masalan: _AQSh_)", { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply("Iltimos, matn shaklida yuboring.");
    ctx.wizard.state.movieData.country = ctx.message.text;
    await ctx.reply("📅 *Chiqarilgan yilini kiriting:*\n(Masalan: _2023_)", { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply("Iltimos, matn shaklida yuboring.");
    ctx.wizard.state.movieData.year = ctx.message.text;
    await ctx.reply("🎭 *Kino janrini kiriting:*\n(Masalan: _Jangari, Fantastika_)", { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply("Iltimos, matn shaklida yuboring.");
    ctx.wizard.state.movieData.genre = ctx.message.text;
    await ctx.reply("🖼 *Kino uchun muqova rasmini (Poster) yuboring:*", { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.photo) return ctx.reply("Iltimos, rasm shaklida yuboring!");
    ctx.wizard.state.movieData.photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await ctx.reply("📹 *Endi kino videofaylini yuboring:*", { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.video) return ctx.reply("Iltimos, video fayl yuboring!");

    const videoId = ctx.message.video.file_id;
    const data = ctx.wizard.state.movieData;
    const nextCode = getNextCode();
    const captionText = buildCaption(nextCode, data, getBotUsername(ctx));

    try {
      const sentVideo = await ctx.telegram.sendVideo(BAZA_CHANNEL_ID, videoId, {
        caption: captionText,
        parse_mode: 'Markdown',
      });

      const sentPhoto = await ctx.telegram.sendPhoto(BAZA_CHANNEL_ID, data.photoId, {
        caption: `🍿 **${data.title}** kinosi bazaga qo'shildi!\n🔑 Kodi: \`${nextCode}\``,
        parse_mode: 'Markdown',
      });

      // Endi TO'LIQ ma'lumot saqlanadi (tahrirlash uchun kerak bo'ladi)
      movies[nextCode] = {
        title: data.title,
        country: data.country,
        year: data.year,
        genre: data.genre,
        video_chat_id: sentVideo.chat.id,
        video_message_id: sentVideo.message_id,
        photo_message_id: sentPhoto.message_id,
      };
      saveDB();

      await ctx.reply(
        `✅ *Kino bazaga muvaffaqiyatli qo'shildi!*\n\n🔑 *Kino ID'si:* \`${nextCode}\`\n\nUshbu ID orqali kelajakda kinoni tahrirlashingiz yoki o'chirishingiz mumkin.`,
        { parse_mode: 'Markdown', ...getMainMenu(ctx.from.id) }
      );
    } catch (e) {
      console.log('Xatolik:', e);
      await ctx.reply("❌ Kanalga joylashda xatolik yuz berdi. Bot kanallarda Admin ekanini tekshiring.");
    }

    return ctx.scene.leave();
  }
);

addMovieWizard.command('bekor', async (ctx) => {
  await ctx.reply('❌ Bekor qilindi.', getMainMenu(ctx.from.id));
  return ctx.scene.leave();
});

// ---------------------------------------------------------
// KINO TAHRIRLASH WIZARD SCENE
// ---------------------------------------------------------
const editMovieWizard = new Scenes.WizardScene(
  'EDIT_MOVIE_SCENE',

  // 1-bosqich: ID so'rash
  async (ctx) => {
    await ctx.reply("✏️ *Tahrirlamoqchi bo'lgan kinoning ID (kodi)ni kiriting:*\n\n❌ Bekor qilish uchun /bekor yozing.", {
      parse_mode: 'Markdown',
    });
    return ctx.wizard.next();
  },

  // 2-bosqich: ID tekshirish, nimani tahrirlashni so'rash
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply("Iltimos, ID raqamini matn shaklida yuboring.");
    const id = ctx.message.text.trim();

    if (!movies[id]) {
      await ctx.reply(`❌ \`${id}\` ID'li kino topilmadi. Qaytadan urinib ko'ring yoki /bekor yozing.`, {
        parse_mode: 'Markdown',
      });
      return; // shu bosqichda qoladi, qayta ID kiritishi mumkin
    }

    ctx.wizard.state.movieId = id;
    const movie = movies[id];

    await ctx.reply(
      `🎬 *${movie.title}*\n🌍 ${movie.country} | 📅 ${movie.year} | 🎭 ${movie.genre}\n\nNimani tahrirlamoqchisiz?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Nomi', 'edit_title'), Markup.button.callback('🌍 Davlati', 'edit_country')],
          [Markup.button.callback('📅 Yili', 'edit_year'), Markup.button.callback('🎭 Janri', 'edit_genre')],
          [Markup.button.callback('🖼 Posteri', 'edit_photo'), Markup.button.callback('📹 Videosi', 'edit_video')],
          [Markup.button.callback('❌ Bekor qilish', 'edit_cancel')],
        ]),
      }
    );
    return ctx.wizard.next();
  },

  // 3-bosqich: qaysi maydon tanlanganini kutish (callback orqali keladi)
  async (ctx) => {
    if (!ctx.callbackQuery) return; // hali tugma bosilmagan, kutamiz
    await ctx.answerCbQuery();
    const field = ctx.callbackQuery.data;

    if (field === 'edit_cancel') {
      await ctx.editMessageText('❌ Bekor qilindi.');
      return ctx.scene.leave();
    }

    ctx.wizard.state.field = field;

    const prompts = {
      edit_title: '📝 Yangi *nomini* kiriting:',
      edit_country: '🌍 Yangi *davlatini* kiriting:',
      edit_year: '📅 Yangi *yilini* kiriting:',
      edit_genre: '🎭 Yangi *janrini* kiriting:',
      edit_photo: '🖼 Yangi *poster rasmni* yuboring:',
      edit_video: '📹 Yangi *video faylni* yuboring:',
    };

    await ctx.editMessageText(prompts[field] || 'Yangi qiymatni yuboring:', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },

  // 4-bosqich: yangi qiymatni qabul qilish va yangilash
  async (ctx) => {
    const id = ctx.wizard.state.movieId;
    const field = ctx.wizard.state.field;
    const movie = movies[id];

    if (!movie) {
      await ctx.reply('❌ Kino topilmadi (ehtimol allaqachon o‘chirilgan).');
      return ctx.scene.leave();
    }

    try {
      if (field === 'edit_title' || field === 'edit_country' || field === 'edit_year' || field === 'edit_genre') {
        if (!ctx.message || !ctx.message.text) return ctx.reply('Iltimos, matn shaklida yuboring.');
        const map = { edit_title: 'title', edit_country: 'country', edit_year: 'year', edit_genre: 'genre' };
        movie[map[field]] = ctx.message.text;

        // Kanaldagi captionni ham yangilaymiz
        const newCaption = buildCaption(id, movie, getBotUsername(ctx), null, getRatingStats(movie));
        await ctx.telegram.editMessageCaption(movie.video_chat_id, movie.video_message_id, undefined, newCaption, {
          parse_mode: 'Markdown',
        });
      } else if (field === 'edit_photo') {
        if (!ctx.message || !ctx.message.photo) return ctx.reply('Iltimos, rasm shaklida yuboring.');
        const newPhotoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

        // Eski posterni o'chirishga urinamiz, keyin yangisini yuboramiz
        try {
          await ctx.telegram.deleteMessage(BAZA_CHANNEL_ID, movie.photo_message_id);
        } catch (e) {}

        const sentPhoto = await ctx.telegram.sendPhoto(BAZA_CHANNEL_ID, newPhotoId, {
          caption: `🍿 **${movie.title}** kinosi posteri yangilandi!\n🔑 Kodi: \`${id}\``,
          parse_mode: 'Markdown',
        });
        movie.photo_message_id = sentPhoto.message_id;
      } else if (field === 'edit_video') {
        if (!ctx.message || !ctx.message.video) return ctx.reply('Iltimos, video fayl yuboring.');
        const newVideoId = ctx.message.video.file_id;
        const newCaption = buildCaption(id, movie, getBotUsername(ctx), null, getRatingStats(movie));

        try {
          await ctx.telegram.deleteMessage(movie.video_chat_id, movie.video_message_id);
        } catch (e) {}

        const sentVideo = await ctx.telegram.sendVideo(BAZA_CHANNEL_ID, newVideoId, {
          caption: newCaption,
          parse_mode: 'Markdown',
        });
        movie.video_chat_id = sentVideo.chat.id;
        movie.video_message_id = sentVideo.message_id;
      }

      saveDB();
      await ctx.reply(`✅ *${id}* ID'li kino muvaffaqiyatli yangilandi!`, {
        parse_mode: 'Markdown',
        ...getMainMenu(ctx.from.id),
      });
    } catch (e) {
      console.log('Tahrirlash xatoligi:', e);
      await ctx.reply('❌ Yangilashda xatolik yuz berdi.');
    }

    return ctx.scene.leave();
  }
);

editMovieWizard.command('bekor', async (ctx) => {
  await ctx.reply('❌ Bekor qilindi.', getMainMenu(ctx.from.id));
  return ctx.scene.leave();
});

// ---------------------------------------------------------
// KINO O'CHIRISH WIZARD SCENE
// ---------------------------------------------------------
const deleteMovieWizard = new Scenes.WizardScene(
  'DELETE_MOVIE_SCENE',

  async (ctx) => {
    await ctx.reply("🗑 *O'chirmoqchi bo'lgan kinoning ID (kodi)ni kiriting:*\n\n❌ Bekor qilish uchun /bekor yozing.", {
      parse_mode: 'Markdown',
    });
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply('Iltimos, ID raqamini yuboring.');
    const id = ctx.message.text.trim();

    if (!movies[id]) {
      await ctx.reply(`❌ \`${id}\` ID'li kino topilmadi. Qaytadan urinib ko'ring yoki /bekor yozing.`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    ctx.wizard.state.movieId = id;
    const movie = movies[id];

    await ctx.reply(
      `⚠️ *${movie.title}* (ID: \`${id}\`) kinosini rostdan ham o'chirmoqchimisiz?\n\nBu amalni orqaga qaytarib bo'lmaydi!`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Ha, o\'chirish', 'confirm_delete'), Markup.button.callback('❌ Yo\'q', 'cancel_delete')],
        ]),
      }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery) return;
    await ctx.answerCbQuery();
    const id = ctx.wizard.state.movieId;
    const movie = movies[id];

    if (ctx.callbackQuery.data === 'cancel_delete') {
      await ctx.editMessageText('❌ Bekor qilindi, kino o\'chirilmadi.');
      return ctx.scene.leave();
    }

    if (movie) {
      try {
        await ctx.telegram.deleteMessage(movie.video_chat_id, movie.video_message_id);
      } catch (e) {}
      try {
        await ctx.telegram.deleteMessage(BAZA_CHANNEL_ID, movie.photo_message_id);
      } catch (e) {}

      delete movies[id];
      saveDB();

      // Barcha foydalanuvchilarning sevimlilar ro'yxatidan ham o'chirilgan kinoni tozalaymiz
      let favoritesChanged = false;
      Object.keys(favorites).forEach((uid) => {
        const idx = favorites[uid].indexOf(id);
        if (idx !== -1) {
          favorites[uid].splice(idx, 1);
          favoritesChanged = true;
        }
      });
      if (favoritesChanged) saveFavorites();

      await ctx.editMessageText(`✅ \`${id}\` ID'li kino muvaffaqiyatli o'chirildi.`, { parse_mode: 'Markdown' });
    } else {
      await ctx.editMessageText('❌ Kino topilmadi.');
    }

    return ctx.scene.leave();
  }
);

deleteMovieWizard.command('bekor', async (ctx) => {
  await ctx.reply('❌ Bekor qilindi.', getMainMenu(ctx.from.id));
  return ctx.scene.leave();
});

// ---------------------------------------------------------
// MAJBURIY OBUNA KANAL QO'SHISH SCENE
// ---------------------------------------------------------
const addSubChannelWizard = new Scenes.WizardScene(
  'ADD_SUB_CHANNEL_SCENE',

  async (ctx) => {
    await ctx.reply(
      "📡 *Majburiy obuna uchun kanal qo'shish*\n\n" +
        "Kanal username'ini (masalan: `@aerokino`) yoki ID'sini yuboring.\n\n" +
        "⚠️ *Muhim:* bot o'sha kanalda ADMIN bo'lishi shart, aks holda obunani tekshira olmaydi!\n\n" +
        '❌ Bekor qilish uchun /bekor yozing.',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply('Iltimos, matn shaklida yuboring.');
    const input = ctx.message.text.trim();

    let chat;
    try {
      chat = await ctx.telegram.getChat(input);
    } catch (e) {
      await ctx.reply(
        "❌ Bunday kanal topilmadi. Username yoki ID to'g'ri ekanini tekshiring, qaytadan yuboring yoki /bekor yozing."
      );
      return;
    }

    try {
      const botMember = await ctx.telegram.getChatMember(chat.id, ctx.botInfo.id);
      if (!['administrator', 'creator'].includes(botMember.status)) {
        await ctx.reply(
          "❌ Bot bu kanalda ADMIN emas! Avval botni kanalga administrator qilib qo'shing, so'ng qaytadan urinib ko'ring yoki /bekor yozing."
        );
        return;
      }
    } catch (e) {
      await ctx.reply("❌ Kanal a'zolarini tekshirib bo'lmadi. Bot kanalga admin qilib qo'shilganini tekshiring.");
      return;
    }

    ctx.wizard.state.newChannel = {
      id: chat.id,
      title: chat.title || input,
      username: chat.username ? `@${chat.username}` : null,
    };

    if (chat.username) {
      ctx.wizard.state.newChannel.link = `https://t.me/${chat.username}`;
      subChannels.push(ctx.wizard.state.newChannel);
      saveChannels();
      await ctx.reply(`✅ *${ctx.wizard.state.newChannel.title}* kanali majburiy obunaga qo'shildi!`, {
        parse_mode: 'Markdown',
        ...getMainMenu(ctx.from.id),
      });
      return ctx.scene.leave();
    }

    await ctx.reply(
      "🔗 Bu kanalning ochiq username'i yo'q (yopiq kanal). Iltimos, taklif havolasini (invite link) yuboring:\n" +
        '(Kanal sozlamalari → Invite Link orqali olishingiz mumkin)'
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply('Iltimos, havolani matn shaklida yuboring.');
    ctx.wizard.state.newChannel.link = ctx.message.text.trim();
    subChannels.push(ctx.wizard.state.newChannel);
    saveChannels();
    await ctx.reply(`✅ *${ctx.wizard.state.newChannel.title}* kanali majburiy obunaga qo'shildi!`, {
      parse_mode: 'Markdown',
      ...getMainMenu(ctx.from.id),
    });
    return ctx.scene.leave();
  }
);

addSubChannelWizard.command('bekor', async (ctx) => {
  await ctx.reply('❌ Bekor qilindi.', getMainMenu(ctx.from.id));
  return ctx.scene.leave();
});

// ---------------------------------------------------------
// XABAR YUBORISH (BROADCAST) SCENE
// ---------------------------------------------------------
const broadcastWizard = new Scenes.WizardScene(
  'BROADCAST_SCENE',

  async (ctx) => {
    await ctx.reply(
      "📣 *Barcha foydalanuvchilarga yubormoqchi bo'lgan xabaringizni yuboring* (matn, rasm yoki video bo'lishi mumkin):\n\n❌ Bekor qilish uchun /bekor yozing.",
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message) return ctx.reply('Iltimos, xabar yuboring.');

    await ctx.reply(`⏳ Xabar ${users.length} ta foydalanuvchiga yuborilmoqda, biroz kuting...`);

    let success = 0;
    let fail = 0;
    for (const uid of users) {
      try {
        await ctx.telegram.copyMessage(uid, ctx.chat.id, ctx.message.message_id);
        success++;
      } catch (e) {
        fail++;
      }
    }

    await ctx.reply(
      `✅ *Xabar yuborish tugadi!*\n\n✅ Muvaffaqiyatli: ${success}\n❌ Yetib bormadi (bot bloklangan/hisob o'chirilgan): ${fail}`,
      { parse_mode: 'Markdown', ...getMainMenu(ctx.from.id) }
    );
    return ctx.scene.leave();
  }
);

broadcastWizard.command('bekor', async (ctx) => {
  await ctx.reply('❌ Bekor qilindi.', getMainMenu(ctx.from.id));
  return ctx.scene.leave();
});

// ---------------------------------------------------------
// POST YARATISH SCENE
// ---------------------------------------------------------
const createPostWizard = new Scenes.WizardScene(
  'CREATE_POST_SCENE',
  async (ctx) => {
    await ctx.reply(
      "📢 *Asosiy kanalga post joylash*\n\n" +
        "• Kino e'lon qilmoqchi bo'lsangiz — kino *ID*'sini yuboring (masalan: `1`)\n" +
        "• Oddiy post yubormoqchi bo'lsangiz — matn/rasm/videoni to'g'ridan-to'g'ri yuboring\n\n" +
        '❌ Bekor qilish uchun /bekor yozing.',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message) return ctx.reply('Iltimos, xabar yuboring.');

    const text = ctx.message.text ? ctx.message.text.trim() : null;

    // Agar yuborilgan matn mavjud kino ID'siga mos kelsa — kino e'lonini avtomatik yasaymiz
    if (text && movies[text]) {
      const code = text;
      const movie = movies[code];
      const botUsername = getBotUsername(ctx);
      const deepLink = `https://t.me/${botUsername}?start=${code}`;
      const caption = buildCaption(code, movie, botUsername, null, getRatingStats(movie));

      try {
        await ctx.telegram.copyMessage(MAIN_CHANNEL_ID, BAZA_CHANNEL_ID, movie.photo_message_id, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: "🎬 Ko'rish / Yuklab olish", url: deepLink }]],
          },
        });
        await ctx.reply(`✅ *${movie.title}* (ID: \`${code}\`) e'loni Asosiy kanalga joylandi!`, {
          parse_mode: 'Markdown',
          ...getMainMenu(ctx.from.id),
        });
      } catch (e) {
        console.log('Post xatoligi:', e);
        await ctx.reply('❌ Kino e\'lonini kanalga yuborishda xatolik bo\'ldi.');
      }
      return ctx.scene.leave();
    }

    // Aks holda — oddiy post sifatida forward qilamiz
    try {
      await ctx.telegram.copyMessage(MAIN_CHANNEL_ID, ctx.chat.id, ctx.message.message_id);
      await ctx.reply('✅ Post *Asosiy kanalga* muvaffaqiyatli joylandi!', {
        parse_mode: 'Markdown',
        ...getMainMenu(ctx.from.id),
      });
    } catch (e) {
      await ctx.reply('❌ Postni kanalga yuborishda xatolik bo\'ldi.');
    }
    return ctx.scene.leave();
  }
);

createPostWizard.command('bekor', async (ctx) => {
  await ctx.reply('❌ Bekor qilindi.', getMainMenu(ctx.from.id));
  return ctx.scene.leave();
});

// ---------------------------------------------------------
// IZOH QOLDIRISH SCENE
// ---------------------------------------------------------
const addCommentWizard = new Scenes.WizardScene(
  'ADD_COMMENT_SCENE',

  async (ctx) => {
    const movie = movies[ctx.scene.state.movieId];
    if (!movie) {
      await ctx.reply('❌ Kino topilmadi.', getMainMenu(ctx.from.id));
      return ctx.scene.leave();
    }
    await ctx.reply(`✍️ *${movie.title}* uchun izohingizni yozing:\n\n❌ Bekor qilish uchun /bekor yozing.`, {
      parse_mode: 'Markdown',
    });
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply('Iltimos, izohni matn shaklida yuboring.');

    const code = ctx.scene.state.movieId;
    const movie = movies[code];
    if (!movie) {
      await ctx.reply('❌ Kino topilmadi.', getMainMenu(ctx.from.id));
      return ctx.scene.leave();
    }

    movie.comments = movie.comments || [];
    movie.comments.push({
      userId: ctx.from.id,
      name: ctx.from.first_name || ctx.from.username || 'Foydalanuvchi',
      text: ctx.message.text,
      date: new Date().toISOString(),
    });
    saveDB();

    await ctx.reply('✅ Izohingiz uchun rahmat!', getMainMenu(ctx.from.id));
    return ctx.scene.leave();
  }
);

addCommentWizard.command('bekor', async (ctx) => {
  await ctx.reply('❌ Bekor qilindi.', getMainMenu(ctx.from.id));
  return ctx.scene.leave();
});

// ---------------------------------------------------------
// ADMIN QO'SHISH SCENE (faqat owner uchun)
// ---------------------------------------------------------
const addAdminWizard = new Scenes.WizardScene(
  'ADD_ADMIN_SCENE',

  async (ctx) => {
    await ctx.reply(
      "👤 *Yangi admin qo'shish*\n\n" +
        "Yangi adminning Telegram ID raqamini yuboring (masalan: `123456789`).\n" +
        "ID'ni bilish uchun foydalanuvchi @userinfobot ga /start bosishi kifoya.\n\n" +
        '❌ Bekor qilish uchun /bekor yozing.',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message || !ctx.message.text) return ctx.reply('Iltimos, ID raqamini matn shaklida yuboring.');
    const idText = ctx.message.text.trim();

    if (!/^\d+$/.test(idText)) {
      await ctx.reply("❌ Bu to'g'ri ID emas. Faqat raqam yuboring (masalan: `123456789`) yoki /bekor yozing.", {
        parse_mode: 'Markdown',
      });
      return;
    }

    const newId = Number(idText);

    if (newId === ADMIN_ID || admins.includes(newId)) {
      await ctx.reply('❌ Bu foydalanuvchi allaqachon admin.', getMainMenu(ctx.from.id));
      return ctx.scene.leave();
    }

    admins.push(newId);
    saveAdmins();

    await ctx.reply(`✅ *${newId}* ID'li foydalanuvchi endi admin!`, {
      parse_mode: 'Markdown',
      ...getMainMenu(ctx.from.id),
    });
    return ctx.scene.leave();
  }
);

addAdminWizard.command('bekor', async (ctx) => {
  await ctx.reply('❌ Bekor qilindi.', getMainMenu(ctx.from.id));
  return ctx.scene.leave();
});

// Stage va Session sozlamalari
const stage = new Scenes.Stage([
  addMovieWizard,
  createPostWizard,
  editMovieWizard,
  deleteMovieWizard,
  addSubChannelWizard,
  broadcastWizard,
  addCommentWizard,
  addAdminWizard,
]);
bot.use(session());
bot.use(stage.middleware());

// Majburiy obuna tekshiruvi — admin uchun ishlamaydi, "✅ Tekshirish" tugmasi o'z handleriga o'tadi
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  if (isAdmin(ctx)) return next();
  if (ctx.callbackQuery && ctx.callbackQuery.data === 'check_subscription') return next();

  const unsub = await getUnsubscribedChannels(ctx);
  if (unsub.length === 0) return next();

  await ctx.reply("📡 *Botdan foydalanish uchun quyidagi kanal(lar)ga obuna bo'ling:*", {
    parse_mode: 'Markdown',
    ...buildSubscribeKeyboard(unsub),
  });
});

// ---------------------------------------------------------
// KLAVIATURALAR VA ASOSIY MANTIQ
// ---------------------------------------------------------

// Eslatma: Telegram bot tugmalariga rang qo'yish imkoni yo'q (bu Telegramning
// o'z cheklovi — hech qanday bot buni qila olmaydi). Shuning uchun tugmalar
// emoji va aniq tartib bilan chiroyli va tushunarli qilib joylashtirilgan.

function getMainMenu(userId) {
  const buttons = [
    ['🔍 Kino qidirish', '⭐ Sevimlilarim'],
    ['📊 Bot statistikasi', '💬 Biz bilan aloqa'],
    ['📢 Asosiy Kanal'],
  ];

  if (isAdminId(userId)) {
    buttons.unshift(['⚙️ Boshqarish paneli']);
  }

  return Markup.keyboard(buttons).resize();
}

// Admin paneli klaviaturasi — "Adminlar" bo'limi faqat asosiy adminga (owner) ko'rinadi
function buildAdminPanelKeyboard(ctx) {
  const rows = [
    [Markup.button.callback('🎬 Kino qo\'shish', 'admin_add_movie')],
    [Markup.button.callback('✏️ Kino tahrirlash', 'admin_edit_movie'), Markup.button.callback('🗑 Kino o\'chirish', 'admin_delete_movie')],
    [Markup.button.callback('📋 Kinolar ro\'yxati', 'admin_movies_list')],
    [Markup.button.callback('📡 Majburiy obuna', 'admin_subchannels')],
    [Markup.button.callback('📢 Kanalga post joylash', 'admin_post'), Markup.button.callback('📣 Xabar yuborish', 'admin_broadcast')],
    [Markup.button.callback('📊 Statistika', 'admin_stats')],
  ];

  if (isOwner(ctx)) {
    rows.push([Markup.button.callback('👤 Adminlar', 'admin_admins')]);
  }

  rows.push([Markup.button.callback('❌ Panelni yopish', 'admin_close')]);
  return Markup.inlineKeyboard(rows);
}

function buildAdminsPanelText() {
  let text = `👤 *Adminlar ro'yxati*\n\n👑 Asosiy admin (siz) — ID: \`${ADMIN_ID}\`\n`;
  if (admins.length) {
    const lines = admins.map((id, i) => `${i + 1}. ID: \`${id}\``);
    text += `\n➕ Qo'shimcha adminlar:\n${lines.join('\n')}\n\nOlib tashlash uchun adminga bosing:`;
  } else {
    text += "\nQo'shimcha adminlar hozircha yo'q.";
  }
  return text;
}

function buildAdminsPanelKeyboard() {
  const rows = admins.map((id, i) => [Markup.button.callback(`🗑 ${id}`, `deladmin_${i}`)]);
  rows.push([Markup.button.callback('➕ Admin qo\'shish', 'admin_add_admin')]);
  rows.push([Markup.button.callback('🔙 Orqaga', 'admin_back')]);
  return Markup.inlineKeyboard(rows);
}

function buildSubChannelsPanelText() {
  let text = `📡 *Majburiy obuna kanallari*\n\n✅ ${mainChannelTitle} (asosiy kanal — doim majburiy)\n`;
  if (subChannels.length) {
    const lines = subChannels.map((ch, i) => `${i + 1}. ${ch.title} (${ch.username || ch.id})`);
    text += `\n➕ Qo'shimcha kanallar:\n${lines.join('\n')}\n\nO'chirish uchun kanalga bosing:`;
  } else {
    text += "\nQo'shimcha kanallar hozircha yo'q.";
  }
  return text;
}

function buildSubChannelsPanelKeyboard() {
  const rows = subChannels.map((ch, i) => [Markup.button.callback(`🗑 ${ch.title}`, `delsub_${i}`)]);
  rows.push([Markup.button.callback('➕ Kanal qo\'shish', 'admin_add_subchannel')]);
  rows.push([Markup.button.callback('🔙 Orqaga', 'admin_back')]);
  return Markup.inlineKeyboard(rows);
}

// 1. /start
bot.start(async (ctx) => {
  addUser(ctx.from.id);

  // Agar foydalanuvchi kanaldagi "Ko'rish / Yuklab olish" tugmasi orqali kirgan bo'lsa
  // (masalan https://t.me/bot?start=5), to'g'ridan-to'g'ri o'sha kinoni yuboramiz
  const payload = ctx.startPayload;
  if (payload && movies[payload]) {
    await sendMovieToUser(ctx, payload);
    return;
  }

  ctx.reply(`🎬 *AERO KINO BOT ga xush kelibsiz!*\n\n🔑 Kino kodini yuboring yoki pastdagi menyudan foydalaning:`, {
    parse_mode: 'Markdown',
    ...getMainMenu(ctx.from.id),
  });
});

// 2. Admin panelini ochish
bot.hears('⚙️ Boshqarish paneli', (ctx) => {
  if (isAdmin(ctx)) {
    ctx.reply(`🎛 *ADMIN BOSHQARUV PANELI*\n\nKerakli bo'limni tanlang 👇`, {
      parse_mode: 'Markdown',
      ...buildAdminPanelKeyboard(ctx),
    });
  } else {
    ctx.reply('❌ Siz admin emassiz!');
  }
});

// 3. Admin inline tugmalari
bot.action('admin_add_movie', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.scene.enter('ADD_MOVIE_SCENE');
});

bot.action('admin_edit_movie', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.scene.enter('EDIT_MOVIE_SCENE');
});

bot.action('admin_delete_movie', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.scene.enter('DELETE_MOVIE_SCENE');
});

bot.action('admin_post', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.scene.enter('CREATE_POST_SCENE');
});

bot.action('admin_stats', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  const total = Object.keys(movies).length;
  ctx.reply(
    `📊 *Statistika*\n\n🎬 Jami kinolar: ${total}\n👥 Jami foydalanuvchilar: ${users.length}\n📡 Majburiy obuna kanallari: ${subChannels.length}`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('admin_movies_list', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  const ids = Object.keys(movies);
  if (!ids.length) {
    return ctx.reply("📋 Bazada hozircha hech qanday kino yo'q.");
  }
  const lines = ids.map((id) => `🔑 \`${id}\` — ${movies[id].title}`);
  // Telegram xabar uzunligi cheklangani uchun juda uzun bo'lsa bo'lib yuboramiz
  const chunkSize = 50;
  for (let i = 0; i < lines.length; i += chunkSize) {
    ctx.reply(`📋 *Kinolar ro'yxati (${i + 1}-${Math.min(i + chunkSize, lines.length)}):*\n\n${lines.slice(i, i + chunkSize).join('\n')}`, {
      parse_mode: 'Markdown',
    });
  }
});

bot.action('admin_broadcast', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.scene.enter('BROADCAST_SCENE');
});

bot.action('admin_subchannels', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.editMessageText(buildSubChannelsPanelText(), {
    parse_mode: 'Markdown',
    ...buildSubChannelsPanelKeyboard(),
  }).catch(() => ctx.reply(buildSubChannelsPanelText(), { parse_mode: 'Markdown', ...buildSubChannelsPanelKeyboard() }));
});

bot.action('admin_add_subchannel', (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.scene.enter('ADD_SUB_CHANNEL_SCENE');
});

bot.action(/^delsub_(\d+)$/, (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  const index = parseInt(ctx.match[1], 10);
  const removed = subChannels.splice(index, 1);
  saveChannels();
  ctx.answerCbQuery(removed.length ? `🗑 ${removed[0].title} o'chirildi` : 'O\'chirildi');
  ctx.editMessageText(buildSubChannelsPanelText(), {
    parse_mode: 'Markdown',
    ...buildSubChannelsPanelKeyboard(),
  });
});

bot.action('admin_back', (ctx) => {
  ctx.answerCbQuery();
  ctx.editMessageText(`🎛 *ADMIN BOSHQARUV PANELI*\n\nKerakli bo'limni tanlang 👇`, {
    parse_mode: 'Markdown',
    ...buildAdminPanelKeyboard(ctx),
  });
});

// --- Adminlarni boshqarish (faqat asosiy admin — owner) ---

bot.action('admin_admins', (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.editMessageText(buildAdminsPanelText(), {
    parse_mode: 'Markdown',
    ...buildAdminsPanelKeyboard(),
  }).catch(() => ctx.reply(buildAdminsPanelText(), { parse_mode: 'Markdown', ...buildAdminsPanelKeyboard() }));
});

bot.action('admin_add_admin', (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  ctx.answerCbQuery();
  ctx.scene.enter('ADD_ADMIN_SCENE');
});

// O'chirishdan oldin tasdiqlash so'raladi
bot.action(/^deladmin_(\d+)$/, (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  const index = parseInt(ctx.match[1], 10);
  const targetId = admins[index];
  if (targetId === undefined) return ctx.answerCbQuery('❌ Topilmadi');
  ctx.answerCbQuery();
  ctx.editMessageText(
    `⚠️ *ID: \`${targetId}\`* adminni rostdan ham olib tashlamoqchimisiz?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ha, olib tashlash', `confirm_deladmin_${index}`), Markup.button.callback('❌ Yo\'q', 'cancel_deladmin')],
      ]),
    }
  );
});

bot.action(/^confirm_deladmin_(\d+)$/, (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery('❌ Ruxsat yo\'q');
  const index = parseInt(ctx.match[1], 10);
  const removed = admins.splice(index, 1);
  saveAdmins();
  ctx.answerCbQuery(removed.length ? `🗑 ${removed[0]} olib tashlandi` : 'Olib tashlandi');
  ctx.editMessageText(buildAdminsPanelText(), {
    parse_mode: 'Markdown',
    ...buildAdminsPanelKeyboard(),
  });
});

bot.action('cancel_deladmin', (ctx) => {
  ctx.answerCbQuery('Bekor qilindi');
  ctx.editMessageText(buildAdminsPanelText(), {
    parse_mode: 'Markdown',
    ...buildAdminsPanelKeyboard(),
  });
});

// Foydalanuvchi "✅ Obunani tekshirish" tugmasini bosganda
bot.action('check_subscription', async (ctx) => {
  const unsub = await getUnsubscribedChannels(ctx);
  if (unsub.length === 0) {
    await ctx.answerCbQuery('✅ Obuna tasdiqlandi!');
    addUser(ctx.from.id);
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(`🎬 *Xush kelibsiz!*\n\n🔑 Kino kodini yuboring yoki pastdagi menyudan foydalaning:`, {
      parse_mode: 'Markdown',
      ...getMainMenu(ctx.from.id),
    });
  } else {
    await ctx.answerCbQuery('❌ Siz hali barcha kanallarga obuna bo\'lmagansiz!', { show_alert: true });
  }
});

bot.action('admin_close', (ctx) => {
  ctx.answerCbQuery();
  ctx.deleteMessage().catch(() => {});
});

// Kinoning boshqa qismiga o'tish (masalan, 2-qismni ko'rish)
bot.action(/^moviepart_(.+)_(\d+)$/, async (ctx) => {
  const code = ctx.match[1];
  const partNumber = parseInt(ctx.match[2], 10);
  await ctx.answerCbQuery();
  try {
    await ctx.deleteMessage();
  } catch (e) {}
  await sendMoviePart(ctx, code, partNumber);
});

// Kinoga baho (1-5 yulduz) qo'yish
bot.action(/^rate_(.+)_(\d+)_([1-5])$/, async (ctx) => {
  const code = ctx.match[1];
  const partNumber = parseInt(ctx.match[2], 10);
  const score = parseInt(ctx.match[3], 10);
  const movie = movies[code];
  if (!movie) return ctx.answerCbQuery('❌ Kino topilmadi', { show_alert: true });

  movie.ratings = movie.ratings || {};
  movie.ratings[ctx.from.id] = score;
  saveDB();

  const stats = getRatingStats(movie);
  await ctx.answerCbQuery(
    `✅ Bahoyingiz: ${score} ⭐\nO'rtacha reyting: ${stats.avg.toFixed(1)}/5 (${stats.count} ta baho)`,
    { show_alert: true }
  );

  const parts = getMovieParts(movie);
  const part = parts.find((p) => p.part === partNumber) || parts[0];
  const keyboard = buildMovieKeyboard(ctx.from.id, code, movie, part, parts);

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard });
  } catch (e) {}

  try {
    const totalParts = parts.length;
    const partInfo = totalParts > 1 ? { current: part.part, total: totalParts } : null;
    const freshCaption = buildCaption(code, movie, getBotUsername(ctx), partInfo, stats);
    await ctx.editMessageCaption(freshCaption, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
  } catch (e) {}
});

// Sevimlilarga qo'shish / olib tashlash
bot.action(/^fav_(.+)_(\d+)$/, async (ctx) => {
  const code = ctx.match[1];
  const partNumber = parseInt(ctx.match[2], 10);
  const movie = movies[code];
  if (!movie) return ctx.answerCbQuery('❌ Kino topilmadi', { show_alert: true });

  const userId = ctx.from.id;
  favorites[userId] = favorites[userId] || [];
  const idx = favorites[userId].indexOf(code);
  let added;
  if (idx === -1) {
    favorites[userId].push(code);
    added = true;
  } else {
    favorites[userId].splice(idx, 1);
    added = false;
  }
  saveFavorites();

  await ctx.answerCbQuery(added ? '❤️ Sevimlilarga qo\'shildi!' : '💔 Sevimlilardan olib tashlandi!');

  const parts = getMovieParts(movie);
  const part = parts.find((p) => p.part === partNumber) || parts[0];
  const keyboard = buildMovieKeyboard(userId, code, movie, part, parts);
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard });
  } catch (e) {}
});

// Izohlarni ko'rsatish
bot.action(/^comments_(.+)_(\d+)$/, async (ctx) => {
  const code = ctx.match[1];
  const movie = movies[code];
  if (!movie) return ctx.answerCbQuery('❌ Kino topilmadi', { show_alert: true });
  await ctx.answerCbQuery();

  const comments = movie.comments || [];
  let text;
  if (!comments.length) {
    text = `💬 *${movie.title}* uchun hali izohlar yo'q.\n\nBirinchi bo'lib izoh qoldiring!`;
  } else {
    const lines = comments
      .slice(-10)
      .map((c) => `👤 *${c.name}:*\n${c.text}`);
    text = `💬 *${movie.title}* — so'nggi izohlar:\n\n${lines.join('\n\n')}`;
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('✍️ Izoh qoldirish', `addcomment_${code}`)]]),
  });
});

// Izoh qoldirish scenasiga kirish
bot.action(/^addcomment_(.+)$/, async (ctx) => {
  const code = ctx.match[1];
  if (!movies[code]) return ctx.answerCbQuery('❌ Kino topilmadi', { show_alert: true });
  await ctx.answerCbQuery();
  ctx.scene.enter('ADD_COMMENT_SCENE', { movieId: code });
});

// 4. Menyu tugmalari
bot.hears('🔍 Kino qidirish', (ctx) => {
  ctx.reply('🔍 Kino raqamli kodini yuboring (masalan: `1`).', { parse_mode: 'Markdown' });
});

bot.hears('📊 Bot statistikasi', (ctx) => {
  const total = Object.keys(movies).length;
  ctx.reply(`📊 Bazada jami *${total}* ta kino mavjud.`, { parse_mode: 'Markdown' });
});

bot.hears('💬 Biz bilan aloqa', (ctx) => {
  ctx.reply('💬 Savol va takliflar uchun admin bilan bog\'laning: @Ziyaviddinov_Ilxom');
});

bot.hears('⭐ Sevimlilarim', (ctx) => {
  const favs = favorites[ctx.from.id] || [];
  const existing = favs.filter((code) => movies[code]);

  if (!existing.length) {
    return ctx.reply(
      "⭐ Sizda hali sevimli kinolar yo'q.\n\nKinoni ko'rayotganingizda ❤️ *Sevimlilarga qo'shish* tugmasini bosing.",
      { parse_mode: 'Markdown' }
    );
  }

  const lines = existing.map((code) => `🔑 \`${code}\` — ${movies[code].title}`);
  ctx.reply(`⭐ *Sizning sevimli kinolaringiz:*\n\n${lines.join('\n')}\n\nKo'rish uchun kodini yuboring.`, {
    parse_mode: 'Markdown',
  });
});

bot.hears('📢 Asosiy Kanal', (ctx) => {
  const link = buildChannelLink(MAIN_CHANNEL_ID);
  ctx.reply('📢 Asosiy kanalimiz:', Markup.inlineKeyboard([[Markup.button.url('🚀 Kanalga o\'tish', link)]]));
});

// 5. Kod bo'yicha kinoni chiqarish
bot.on('text', async (ctx) => {
  await sendMovieToUser(ctx, ctx.message.text.trim());
});

// ---------------------------------------------------------
// ISHGA TUSHIRISH: WEBHOOK (bepul hostinglar uchun, masalan Render)
// yoki POLLING (lokal kompyuter / VPS uchun)
// ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
// Render kabi xizmatlar bu manzilni o'zi avtomatik beradi (RENDER_EXTERNAL_URL).
// Boshqa xizmat ishlatsangiz, .env faylida WEBHOOK_URL=https://... deb qo'lda yozing.
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
const WEBHOOK_PATH = `/webhook/${BOT_TOKEN}`;

let server;

async function startBot() {
  if (WEBHOOK_URL) {
    await bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);
    server = http.createServer((req, res) => {
      // UptimeRobot yoki boshqa "ping" xizmati botni uyg'oq ushlab turishi uchun oddiy sahifa
      if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Bot ishlayapti ✅');
      }
      return bot.webhookCallback(WEBHOOK_PATH)(req, res);
    });
    server.listen(PORT, () => {
      console.log(`🚀 Webhook rejimida ishga tushdi: ${WEBHOOK_URL}${WEBHOOK_PATH}`);
    });
  } else {
    await bot.launch();
    console.log('🚀 Polling rejimida (lokal/VPS) ishga tushdi!');
  }

  // Asosiy kanalning haqiqiy nomini olib, majburiy obuna xabarlarida shu nom ko'rinishi uchun
  bot.telegram
    .getChat(MAIN_CHANNEL_ID)
    .then((chat) => {
      mainChannelTitle = chat.title || mainChannelTitle;
    })
    .catch(() => {
      console.log("⚠️ Asosiy kanal ma'lumotini olib bo'lmadi. Bot kanalda ADMIN ekanini tekshiring!");
    });
}

startBot();

function shutdown(signal) {
  if (server) server.close();
  bot.stop(signal);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));