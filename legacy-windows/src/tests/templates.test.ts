/**
 * The messages and the rendering of them, ported from the Rust tests of the same
 * names: `a_template_a_rule_still_sends_cannot_be_deleted`,
 * `templates_fill_in_the_policy_and_refuse_unknown_names`,
 * `a_client_name_with_an_ampersand_cannot_break_the_message` and
 * `the_plain_text_part_keeps_the_shape_of_the_message`.
 *
 * Rendering is the one part of this edition whose output leaves the building. A
 * placeholder that silently resolves to nothing is a client greeted as "Dear ,"
 * and an unescaped ampersand is a message that arrives half-drawn, so both are
 * checked here rather than trusted to look right in the preview pane.
 */

import * as clients from "../core/repo/clients";
import * as insurers from "../core/repo/insurers";
import * as policies from "../core/repo/policies";
import * as rules from "../core/repo/rules";
import * as templates from "../core/repo/templates";
import {
  Context,
  policyContext,
  preview,
  providerContext,
  render,
  samplePolicy as samplePolicyForPreview,
  toPlainText,
  unknownPlaceholders,
} from "../core/templating";
import { expect, suite, test, throwsKind } from "./harness";
import {
  bookExpiringIn,
  daysFromToday,
  sampleClient,
  samplePolicy,
  sampleRule,
  sampleTemplate,
  tempDb,
} from "./support";

suite("a message in use", () => {
  test("cannot be deleted while a rule still sends it", async () => {
    const db = tempDb("template-guard");
    await db.with(async (conn) => {
      const template = templates.create(conn, sampleTemplate("Renewal due"));
      const spare = templates.create(conn, sampleTemplate("Renewal due, second try"));
      const rule = rules.create(conn, sampleRule("45 days before expiry", template));

      const refusal = await throwsKind(
        "conflict",
        () => templates.remove(conn, template),
        "a template a rule still sends must not be deletable",
      );
      expect.ok(
        refusal.message.includes("1"),
        `the refusal counts the rules in the way: ${refusal.message}`,
      );

      // Point the rule at another message and the old one can go.
      rules.update(conn, rule, sampleRule("45 days before expiry", spare));
      templates.remove(conn, template);
      await throwsKind("not_found", () => templates.get(conn, template));

      const stillThere = rules.list(conn).find((row) => row.id === rule);
      expect.ok(stillThere, "the rule outlives the message it used to send");
      expect.equal(stillThere.templateId, spare);
    });
    db.close();
  });

  test("says what it is missing before it is saved", async () => {
    const db = tempDb("template-validation");
    await db.with(async (conn) => {
      await throwsKind("validation", () =>
        templates.create(conn, { ...sampleTemplate("Nameless"), name: "  " }),
      );
      await throwsKind("validation", () =>
        templates.create(conn, { ...sampleTemplate("No subject"), subject: "" }),
      );
      await throwsKind("validation", () =>
        templates.create(conn, { ...sampleTemplate("No body"), bodyHtml: "   " }),
      );
      await throwsKind("validation", () =>
        templates.create(conn, { ...sampleTemplate("Odd type"), trigger: "carrier_pigeon" }),
      );

      templates.create(conn, sampleTemplate("Renewal due"));
      await throwsKind(
        "conflict",
        () => templates.create(conn, sampleTemplate("Renewal due")),
        "two messages with one name would be indistinguishable in the list",
      );
    });
    db.close();
  });
});

suite("filling a template in", () => {
  test("fills in the policy and refuses unknown names", () => {
    const db = tempDb("templates");
    bookExpiringIn(db, 30, "ananya@example.com");

    db.with((conn) => {
      const provider = providerContext(conn);
      const sample = samplePolicyForPreview(conn);
      expect.ok(sample, "the book has a policy to render against");
      const context = policyContext(conn, sample.id, provider);

      const rendered = render(
        "Dear {{client_name}}, {{policy_number}} with {{insurer_name}} " +
          "ends on {{expiry_date}}. Sum insured {{sum_insured}}. — {{provider_name}}",
        context,
      );
      expect.ok(rendered.includes("Ananya Sharma"), rendered);
      expect.ok(rendered.includes("SH/2026/884213"), rendered);
      expect.ok(rendered.includes("Star Health"), rendered);
      expect.ok(rendered.includes("₹10,00,000"), rendered);
      expect.ok(rendered.includes("Sunrise Insurance Services"), rendered);

      // A name nothing fills leaves a gap rather than braces in the inbox.
      expect.equal(render("[{{nope}}]", context), "[]");
      expect.deepEqual(unknownPlaceholders("{{client_name}} {{nope}}"), ["nope"]);
    });
    db.close();
  });

  test("leaves an unclosed brace exactly as it was written", () => {
    // Eating the rest of the template would turn a typo into a message that stops
    // mid-sentence, which reads as the app having broken rather than the template.
    const context = new Context();
    context.set("client_name", "Ananya");
    expect.equal(render("Dear {{client_name}, hello", context), "Dear {{client_name}, hello");
    expect.equal(render("Cover is 100% {{client_name}}", context), "Cover is 100% Ananya");
  });

  test("cannot be broken by a client name with an ampersand in it", () => {
    const db = tempDb("escaping");
    db.withTx((conn) => {
      const input = sampleClient("Sharma & Sons <Trading>");
      input.email = "sharma@example.com";
      const clientId = clients.create(conn, input);
      const insurerId = insurers.findOrCreate(conn, "Star Health and Allied Insurance");
      policies.create(conn, samplePolicy(clientId, insurerId, "SH/2026/1", daysFromToday(30)));
    });

    db.with((conn) => {
      const provider = providerContext(conn);
      const sample = samplePolicyForPreview(conn);
      expect.ok(sample, "the book has a policy to render against");
      const context = policyContext(conn, sample.id, provider);

      // Names are tidied on the way in, so this checks the escaping rather than
      // the exact capitalisation.
      const html = render("<p>Dear {{client_name}},</p>", context);
      expect.ok(html.includes("Sharma &amp; Sons &lt;"), `got: ${html}`);
      expect.ok(!html.includes("<Trading"), "raw angle brackets got through");

      // The triple brace is the deliberate way to pass HTML through.
      const raw = new Context();
      raw.set("digest_table", "<table><tr><td>1</td></tr></table>");
      expect.ok(render("{{{digest_table}}}", raw).startsWith("<table>"));
    });
    db.close();
  });
});

suite("the preview beside the editor", () => {
  test("renders against a real policy, and against an example without one", () => {
    const empty = tempDb("preview-empty");
    empty.with((conn) => {
      const shown = preview(conn, "Expires {{expiry_date}}", "<p>Dear {{client_name}}, {{oops}}</p>");
      expect.equal(shown.samplePolicy, null, "an empty book has no policy to point at");
      expect.ok(shown.html.includes("Ananya Sharma"), shown.html);
      expect.deepEqual(shown.unknownPlaceholders, ["oops"]);
      expect.equal(shown.text, "Dear Ananya Sharma,", "the text part carries no markup");
    });
    empty.close();

    const booked = tempDb("preview-booked");
    bookExpiringIn(booked, 30, "ananya@example.com");
    booked.with((conn) => {
      const shown = preview(conn, "{{policy_number}} expires {{expiry_date}}", "<p>Hello</p>");
      expect.equal(shown.samplePolicy, "SH/2026/884213 · Ananya Sharma");
      expect.ok(shown.subject.startsWith("SH/2026/884213 expires"), shown.subject);
      expect.deepEqual(shown.unknownPlaceholders, []);
    });
    booked.close();
  });
});

suite("the plain text part", () => {
  test("keeps the shape of the message", () => {
    const html =
      "<div><p>Dear Ananya,</p><p>Your policy expires on <strong>31/03/2027</strong>.</p>" +
      "<table><tr><td>Premium</td><td>&#39;24,500&#39;</td></tr></table>" +
      "<p>Regards,<br />Sunrise</p></div>";
    const text = toPlainText(html);

    expect.ok(text.includes("Dear Ananya,"), text);
    expect.ok(text.includes("Your policy expires on 31/03/2027."), text);
    expect.ok(text.includes("Premium\t'24,500'"), text);
    expect.ok(!text.includes("<"), "no markup survives into the text part");
    expect.ok(!text.includes("\n\n\n"), "nested tags should not leave a run of blank lines");
  });
});
