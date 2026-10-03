require("dotenv").config();

const {
  ChannelSelectMenuBuilder,
  ChannelType,
  Client,
  ComponentType,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  LabelBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("DISCORD_TOKEN dan CLIENT_ID wajib diisi. Salin .env.example menjadi .env lalu isi keduanya.");
  process.exit(1);
}

const COMMAND_NAME = "beautiful-message";
const MODAL_ID = "beautiful-message-builder";
const ACCENT_COLOR = 0x5865f2;
const PING_TEXT = "@everyone";
const PING_PATTERN = /(?<![\w/])@(everyone|here)\b/i;
const MAX_TOTAL_TEXT = 4000;
const MAX_BODY_LENGTH = 4000;
const MAX_URL_LENGTH = 2000;
const TARGET_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

const IDS = {
  postChannel: "postChannel",
  messageBody: "messageBody",
  bannerUrl: "bannerUrl",
};

const beautifulMessage = new SlashCommandBuilder()
  .setName(COMMAND_NAME)
  .setDescription("Buka builder untuk mengirim pesan cantik dengan banner opsional.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

class UserFacingError extends Error {}

function buildModal() {
  const postChannel = new LabelBuilder()
    .setLabel("Post Channel")
    .setDescription("Choose the channel where the beautiful message will be posted.")
    .setChannelSelectMenuComponent(
      new ChannelSelectMenuBuilder()
        .setCustomId(IDS.postChannel)
        .setPlaceholder("Select channel to post in")
        .setChannelTypes(TARGET_CHANNEL_TYPES)
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true),
    );

  const messageBody = new LabelBuilder()
    .setLabel("Message Body")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId(IDS.messageBody)
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Share the announcement, promotion, or story...")
        .setMaxLength(MAX_BODY_LENGTH)
        .setRequired(true),
    );

  const bannerUrl = new LabelBuilder()
    .setLabel("Banner Image URL")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId(IDS.bannerUrl)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("https://example.com/cover.png")
        .setMaxLength(MAX_URL_LENGTH)
        .setRequired(false),
    );

  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle("Beautiful Message Builder")
    .addComponents(postChannel, messageBody, bannerUrl);
}

function buildPrettyMessage({ body, bannerUrl, ping }) {
  const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);

  if (bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(bannerUrl)),
    );
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  const components = [];
  if (ping) components.push(new TextDisplayBuilder().setContent(PING_TEXT));
  components.push(container);

  return components;
}

function permissionName(flag) {
  const entry = Object.entries(PermissionsBitField.Flags).find(([, value]) => value === flag);
  if (!entry) return String(flag);
  return entry[0].replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
}

function isValidBannerUrl(value) {
  return /^https?:\/\/\S+$/i.test(value);
}

async function resolveTargetChannel(interaction, channelId) {
  const cached = interaction.guild.channels.cache.get(channelId);
  const channel = cached ?? (await interaction.guild.channels.fetch(channelId).catch(() => null));

  if (!channel) {
    throw new UserFacingError("Channel tujuan tidak ditemukan anymore. Pilih ulang channel yang lain.");
  }

  if (!channel.isTextBased() || channel.isDMBased()) {
    throw new UserFacingError(`<#${channel.id}> bukan channel teks, jadi tidak bisa jadi tujuan.`);
  }

  return channel;
}

async function handleModalSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.inCachedGuild() || !interaction.guild) {
    throw new UserFacingError("Command ini hanya bisa dipakai di dalam server.");
  }

  const channelField = interaction.fields.getField(IDS.postChannel, ComponentType.ChannelSelect);
  const channelId = channelField.values?.[0];

  if (!channelId) {
    throw new UserFacingError("Channel tujuan belum dipilih.");
  }

  const body = interaction.fields.getTextInputValue(IDS.messageBody).trim();
  const bannerUrl = interaction.fields.getTextInputValue(IDS.bannerUrl).trim();

  if (!body) {
    throw new UserFacingError("Isi message body dulu sebelum mengirim.");
  }

  if (bannerUrl && !isValidBannerUrl(bannerUrl)) {
    throw new UserFacingError("URL banner tidak valid. URL harus diawali `http://` atau `https://`.");
  }

  const channel = await resolveTargetChannel(interaction, channelId);
  const me = interaction.guild.members.me;

  if (!me) {
    throw new UserFacingError("Member bot tidak ditemukan di server ini, kemungkinan cache belum siap.");
  }

  const botPermissions = me.permissionsIn(channel);
  const missing = botPermissions.missing(REQUIRED_BOT_PERMISSIONS);

  if (missing.length > 0) {
    throw new UserFacingError(
      `Aku belum bisa mengirim pesan di ${channel.toString()}. Izin bot yang kurang: ${missing
        .map((flag) => `\`${permissionName(flag)}\``)
        .join(", ")}. Beri izin tersebut lalu coba lagi.`,
    );
  }

  const wantsPing = PING_PATTERN.test(body);
  const canPing =
    wantsPing &&
    botPermissions.has(PermissionFlagsBits.MentionEveryone) &&
    (interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) ?? false);
  const maxBodyLength = MAX_TOTAL_TEXT - (canPing ? PING_TEXT.length : 0);

  if (body.length > maxBodyLength) {
    throw new UserFacingError(
      `Message body terlalu panjang: ${body.length} karakter. Maksimal ${maxBodyLength} karakter${
        canPing ? " (termasuk penanda ping)" : ""
      }.`,
    );
  }

  const sent = await channel.send({
    components: buildPrettyMessage({ body, bannerUrl, ping: canPing }),
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: canPing ? { parse: ["everyone"] } : { parse: [] },
  });

  const notes = [];
  if (wantsPing && !canPing) {
    notes.push("Mention everyone tidak dikirim: izin `Mention Everyone` masih kurang.");
  }

  await interaction.editReply({
    content: [
      `Pesan berhasil dikirim ke ${channel.toString()}. [Lihat pesan](${sent.url})`,
      ...notes,
    ].join("\n"),
  });
}

async function registerGlobalCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const body = [beautifulMessage.toJSON()];

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body });

  console.log(`Command /${COMMAND_NAME} terdaftar secara global.`);
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
      await interaction.showModal(buildModal());
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    const known = error instanceof UserFacingError;
    console.error(`[${interaction.type}] Gagal menangani interaksi:`, error);

    const content = known
      ? error.message
      : "Terjadi kesalahan tak terduga saat memproses permintaan. Coba lagi beberapa saat lagi.";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else if (interaction.isRepliable()) {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      console.error("Gagal mengirim pesan error ke pengguna:", replyError);
    }
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Login berhasil sebagai ${readyClient.user.tag}`);

  try {
    await registerGlobalCommands();
  } catch (error) {
    console.error("Gagal mendaftarkan command global:", error);
  }
});

client.on(Events.Error, (error) => console.error("Error pada client:", error));
client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction));

if (require.main === module) {
  client.login(TOKEN);
}

module.exports = {
  client,
  beautifulMessage,
  buildModal,
  buildPrettyMessage,
  handleModalSubmit,
  handleInteraction,
};