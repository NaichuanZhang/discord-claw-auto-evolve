import { type Interaction } from "discord.js";

// ---------------------------------------------------------------------------
// Component interaction handler (buttons, select menus)
// ---------------------------------------------------------------------------

export async function handleComponentInteraction(
  interaction: Interaction,
): Promise<void> {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  // Placeholder — extend as needed
  await interaction.reply({ content: "Interaction received.", ephemeral: true });
}
