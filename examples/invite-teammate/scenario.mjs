// Example guide: inviting a teammate in a fictional team app.
// A scenario is a scene manifest: where to start, the opening and closing cards, and one
// scene per chapter. Every label passed to a helper is a narration line.
//
// To try it: copy this folder to videos/invite-teammate/, point the locators at your own
// product, then run voice → record → build with the id `invite-teammate`.
export default {
  start: {
    path: "/settings/members",
    ready: ({ page }) => page.getByRole("button", { name: "Invite member" }).waitFor(),
  },
  intro: {
    eyebrow: "Guide 1 of 1",
    title: "Inviting a teammate",
    text: "In this guide we invite a teammate to the workspace. Open the members page, enter an email address and choose a role. The invitation is sent right away.",
  },
  outro: {
    eyebrow: "Done",
    title: "That's it",
    text: "The invitation stays pending until the teammate accepts it. You can resend or revoke it from the same list.",
  },
  scenes: [
    {
      title: "Invite member",
      run: async ({ page, g }) => {
        await g.click(page.getByRole("button", { name: "Invite member" }), "On the Members page, click Invite member in the top-right corner.");
        await page.getByRole("dialog").waitFor();
        await g.say("A dialog opens with two fields: the email address and the role.", 800);
      },
    },
    {
      title: "Email and role",
      run: async ({ page, g }) => {
        await g.click(page.getByRole("textbox", { name: "Email" }), "Type the teammate's email address.");
        await g.type("taylor@example.com");
        await g.click(page.getByRole("combobox", { name: "Role" }), "Then pick a role. Members can edit, viewers can only read.");
        await g.click(page.getByRole("option", { name: "Member" }), "We choose Member.");
      },
    },
    {
      title: "Send",
      run: async ({ page, g }) => {
        await g.click(page.getByRole("button", { name: "Send invitation" }), "Click Send invitation.");
        await page.getByText("Invitation sent").waitFor();
        await g.say("The teammate appears in the list as pending, and an email is on its way.", 1200);
      },
    },
  ],
  // Pins the voice so the bundled narration/ cache matches. Liam is an ElevenLabs premade voice.
  overrides: { voice: { voiceId: "TX3LPaxmHKxFdv7VOQHJ" } },
};
