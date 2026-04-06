// ---------------------------------------------------------------------------
// Discord tool definitions for the Anthropic Messages API
// ---------------------------------------------------------------------------

export const discordTools = [
  {
    name: "send_message",
    description: "Send a message to a Discord channel",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: { type: "string", description: "Discord channel ID" },
        text: { type: "string", description: "Message text to send" },
      },
      required: ["channel_id", "text"],
    },
  },
  {
    name: "add_reaction",
    description: "React to a message with an emoji",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: { type: "string", description: "Channel ID" },
        message_id: {
          type: "string",
          description: "Message ID to react to",
        },
        emoji: {
          type: "string",
          description: "Emoji to react with (unicode or custom :name:id)",
        },
      },
      required: ["channel_id", "message_id", "emoji"],
    },
  },
  {
    name: "get_channel_history",
    description: "Get recent messages from a Discord channel",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: { type: "string", description: "Channel ID" },
        limit: {
          type: "number",
          description: "Number of messages (default 20, max 100)",
        },
      },
      required: ["channel_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// Discord client reference
// ---------------------------------------------------------------------------

// Using `any` for the Discord client and channel types intentionally — this
// module is a thin bridge and fully typing discord.js internals here adds
// complexity with no safety benefit.

let discordClient: any = null;

export function setDiscordClient(client: any): void {
  discordClient = client;
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function handleDiscordTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (!discordClient) {
    return JSON.stringify({ error: "Discord client not available" });
  }

  try {
    switch (name) {
      case "send_message": {
        const channelId = input.channel_id as string;
        const text = input.text as string;
        console.log(`[agent] send_message -> channel ${channelId}`);
        const channel: any = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.send) {
          return JSON.stringify({
            error: `Channel ${channelId} not found or not a text channel`,
          });
        }
        const sent = await channel.send(text);
        return JSON.stringify({
          success: true,
          message_id: sent.id,
          channel_id: channelId,
        });
      }

      case "add_reaction": {
        const channelId = input.channel_id as string;
        const messageId = input.message_id as string;
        const emoji = input.emoji as string;
        console.log(
          `[agent] add_reaction -> channel ${channelId}, message ${messageId}, emoji ${emoji}`,
        );
        const channel: any = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.messages) {
          return JSON.stringify({
            error: `Channel ${channelId} not found or not a text channel`,
          });
        }
        const message = await channel.messages.fetch(messageId);
        await message.react(emoji);
        return JSON.stringify({
          success: true,
          channel_id: channelId,
          message_id: messageId,
          emoji,
        });
      }

      case "get_channel_history": {
        const channelId = input.channel_id as string;
        const limit = Math.min((input.limit as number) || 20, 100);
        console.log(
          `[agent] get_channel_history -> channel ${channelId}, limit ${limit}`,
        );
        const channel: any = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.messages) {
          return JSON.stringify({
            error: `Channel ${channelId} not found or not a text channel`,
          });
        }
        const messages = await channel.messages.fetch({ limit });
        const formatted = Array.from(messages.values()).map((msg: any) => ({
          id: msg.id,
          author: msg.author?.tag ?? "unknown",
          content: msg.content,
          timestamp: msg.createdTimestamp,
        }));
        return JSON.stringify({ messages: formatted });
      }

      default:
        return JSON.stringify({ error: `Unknown discord tool: ${name}` });
    }
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    console.error(`[agent] Discord tool "${name}" failed:`, errorMessage);
    return JSON.stringify({ error: errorMessage });
  }
}
