require("dotenv").config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
const MODAL_PREFIX = "bm_modal:";
const NEW_REF = "new";
const SEND_PREFIX = "bm_send:";
const EDIT_PREFIX = "bm_edit:";
const DRAFT_TTL_MS = 14 * 60 * 1000;
const ACCENT_COLOR = 0x5865f2;
const FALLBACK_PING = "@everyone";
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

/** Draft pratinjau, key = interaction id, value = { userId, guildId, channelId, text, bannerUrl } */
const drafts = new Map();

class UserFacingError extends Error {}

const beautifulMessage = new SlashCommandBuilder()
  .setName(COMMAND_NAME)
  .setDescription("Buka builder untuk mengirim pesan cantik dengan banner opsional.")
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

function buildModal(ref, draft = null) {
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(IDS.postChannel)
    .setPlaceholder("Select channel to post in")
    .setChannelTypes(TARGET_CHANNEL_TYPES)
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true);

  if (draft?.channelId) channelMenu.setDefaultChannels(draft.channelId);

  const postChannel = new LabelBuilder()
    .setLabel("Post Channel")
    .setDescription("Choose the channel where the beautiful message will be posted.")
    .setChannelSelectMenuComponent(channelMenu);

  const bodyInput = new TextInputBuilder()
    .setCustomId(IDS.messageBody)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Share the announcement, promotion, or story...")
    .setMaxLength(MAX_BODY_LENGTH)
    .setRequired(true);

  if (draft) bodyInput.setValue(draft.text);

  const messageBody = new LabelBuilder().setLabel("Message Body").setTextInputComponent(bodyInput);

  const bannerInput = new TextInputBuilder()
    .setCustomId(IDS.bannerUrl)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://example.com/cover.png")
    .setMaxLength(MAX_URL_LENGTH)
    .setRequired(false);

  if (draft?.bannerUrl) bannerInput.setValue(draft.bannerUrl);

  const bannerUrl = new LabelBuilder().setLabel("Banner Image URL").setTextInputComponent(bannerInput);

  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${ref}`)
    .setTitle("Beautiful Message Builder")
    .addComponents(postChannel, messageBody, bannerUrl);
}

/** Kembalikan "@everyone" / "@here" bila ada di teks, selain itu null. */
function detectPing(text) {
  const match = text.match(PING_PATTERN);
  return match ? `@${match[1].toLowerCase()}` : null;
}

function previewHeader(draft) {
  return `-# Preview, akan dikirim ke <#${draft.channelId}>`;
}

function previewFooter(draft) {
  return `-# Message written by <@${draft.userId}>, not <@${client.user.id}>`;
}

function finalComponents(draft, withPing) {
  const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);

  if (draft.bannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(draft.bannerUrl)),
    );
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(draft.text));

  const components = [];
  if (withPing) components.push(new TextDisplayBuilder().setContent(detectPing(draft.text) ?? FALLBACK_PING));
  components.push(container);

  return components;
}

function previewPayload(draftId, draft) {
  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
    components: [
      new TextDisplayBuilder().setContent(previewHeader(draft)),
      ...finalComponents(draft, detectPing(draft.text) !== null),
      new TextDisplayBuilder().setContent(previewFooter(draft)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${SEND_PREFIX}${draftId}`)
          .setLabel("Confirm Send")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${EDIT_PREFIX}${draftId}`)
          .setLabel("Update Message")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function assertTextBudget(text, overhead) {
  const total = text.length + overhead;

  if (total > MAX_TOTAL_TEXT) {
    throw new UserFacingError(
      `Isi pesan terlalu panjang: ${total} karakter dari semua TextDisplay, maksimal ${MAX_TOTAL_TEXT}. Pendekkan isi pesan lalu coba lagi.`,
    );
  }
}

/** Karakter yang dipakai header, footer, dan baris ping di preview. */
function previewOverhead(draft) {
  const ping = detectPing(draft.text);

  return previewHeader(draft).length + previewFooter(draft).length + (ping ? ping.length : 0);
}

function permissionName(flag) {
  const entry = Object.entries(PermissionsBitField.Flags).find(([, value]) => value === flag);
  if (!entry) return String(flag);
  return entry[0].replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
}

function isValidBannerUrl(value) {
  return /^https?:\/\/\S+$/i.test(value);
}

function requireDraft(draftId, interaction) {
  const draft = drafts.get(draftId);

  if (!draft || draft.userId !== interaction.user.id || draft.guildId !== interaction.guildId) {
    throw new UserFacingError("Draft kedaluwarsa. Jalankan /beautiful-message lagi.");
  }

  return draft;
}

function storeDraft(draftId, draft) {
  drafts.set(draftId, draft);
  setTimeout(() => drafts.delete(draftId), DRAFT_TTL_MS).unref();
}

function readDraftFromModal(interaction) {
  const channelField = interaction.fields.getField(IDS.postChannel, ComponentType.ChannelSelect);
  const channelId = channelField.values?.[0];

  if (!channelId) {
    throw new UserFacingError("Channel tujuan belum dipilih.");
  }

  const text = interaction.fields.getTextInputValue(IDS.messageBody).trim();
  const bannerUrl = interaction.fields.getTextInputValue(IDS.bannerUrl).trim();

  if (!text) {
    throw new UserFacingError("Isi message body dulu sebelum mengirim.");
  }

  if (bannerUrl && !isValidBannerUrl(bannerUrl)) {
    throw new UserFacingError("URL banner tidak valid. URL harus diawali `http://` atau `https://`.");
  }

  return { channelId, text, bannerUrl };
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

function checkBotPermissions(interaction, channel) {
  const me = interaction.guild?.members.me;

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

  return botPermissions;
}

function resolvePing(draft, botPermissions, interaction) {
  const wantsPing = detectPing(draft.text) !== null;

  const allowed =
    wantsPing &&
    botPermissions.has(PermissionFlagsBits.MentionEveryone) &&
    (interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) ?? false);

  return { wantsPing, allowed };
}

async function handleNewDraft(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guildId) {
    throw new UserFacingError("Command ini hanya bisa dipakai di dalam server.");
  }

  const data = readDraftFromModal(interaction);
  const draftId = interaction.id;
  const draft = { userId: interaction.user.id, guildId: interaction.guildId, ...data };
  assertTextBudget(draft.text, previewOverhead(draft));

  storeDraft(draftId, draft);

  await interaction.editReply(previewPayload(draftId, draft));
}

async function handleDraftUpdate(interaction, draftId) {
  const draft = requireDraft(draftId, interaction);
  const data = readDraftFromModal(interaction);

  Object.assign(draft, data);

  assertTextBudget(draft.text, previewOverhead(draft));

  await interaction.update(previewPayload(draftId, draft));
}

async function handleEditDraft(interaction, draftId) {
  const draft = requireDraft(draftId, interaction);

  await interaction.showModal(buildModal(draftId, draft));
}

async function handleConfirmSend(interaction, draftId) {
  const draft = requireDraft(draftId, interaction);

  await interaction.deferUpdate();

  const channel = await resolveTargetChannel(interaction, draft.channelId);
  const botPermissions = checkBotPermissions(interaction, channel);
  const { wantsPing, allowed } = resolvePing(draft, botPermissions, interaction);

  assertTextBudget(draft.text, allowed ? detectPing(draft.text).length : 0);

  const components = finalComponents(draft, allowed);

  await channel.send({
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: allowed ? { parse: ["everyone"] } : { parse: [] },
  });

  drafts.delete(draftId);

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    components: [new TextDisplayBuilder().setContent(`Terkirim ke ${channel}.`)],
  });

  if (wantsPing && !allowed) {
    await interaction.followUp({
      content: "Mention everyone tidak dikirim: izin `Mention Everyone` masih kurang.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function registerGlobalCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const body = [beautifulMessage.toJSON()];

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body });

  console.log(`Command /${COMMAND_NAME} terdaftar secara global.`);
}

async function respondWithError(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    const isComponentsV2 = interaction.message?.flags?.has(MessageFlags.IsComponentsV2) ?? false;

    await interaction.editReply(
      isComponentsV2
        ? {
            flags: MessageFlags.IsComponentsV2,
            components: [new TextDisplayBuilder().setContent(content)],
          }
        : { content },
    );
  } else if (interaction.isRepliable()) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
      await interaction.showModal(buildModal(NEW_REF));
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX)) {
      const ref = interaction.customId.slice(MODAL_PREFIX.length);

      if (ref === NEW_REF) await handleNewDraft(interaction);
      else await handleDraftUpdate(interaction, ref);

      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(SEND_PREFIX)) {
      await handleConfirmSend(interaction, interaction.customId.slice(SEND_PREFIX.length));
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(EDIT_PREFIX)) {
      await handleEditDraft(interaction, interaction.customId.slice(EDIT_PREFIX.length));
      return;
    }
  } catch (error) {
    const known = error instanceof UserFacingError;
    console.error(`[${interaction.type}] Gagal menangani interaksi:`, error);

    const content = known
      ? error.message
      : "Terjadi kesalahan tak terduga saat memproses permintaan. Coba lagi beberapa saat lagi.";

    try {
      await respondWithError(interaction, content);
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
  drafts,
  beautifulMessage,
  buildModal,
  finalComponents,
  previewPayload,
  detectPing,
  handleInteraction,
};