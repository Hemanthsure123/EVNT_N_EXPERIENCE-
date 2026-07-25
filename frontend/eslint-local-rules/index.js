'use strict';

/**
 * Local ESLint rules for the design system.
 *
 * `no-raw-values` is the enforcement backbone of "design system as the single
 * source of truth": components may never hard-code a colour or a pixel size —
 * every value must resolve through a token / Tailwind theme class. It fails on:
 *   - a hex colour literal anywhere in TS/TSX (`#7C3AED`, `#fff`);
 *   - a Tailwind arbitrary pixel value in a class string (`w-[13px]`, `text-[10px]`);
 *   - a Tailwind arbitrary hex colour (`bg-[#fff]`).
 * The ONE place raw values are allowed is styles/tokens.css (CSS, not linted here).
 */

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const ARBITRARY_PX = /\[[^\]]*?\d+px[^\]]*?\]/;
const ARBITRARY_HEX = /\[#[0-9a-fA-F]{3,8}\]/;

/** @type {import('eslint').Rule.RuleModule} */
const noRawValues = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hard-coded hex colours and raw px sizes; use design tokens / Tailwind theme classes.',
    },
    messages: {
      hex: "Raw hex colour '{{ value }}' is not allowed — use a design token (e.g. text-primary, bg-surface). Colours live in styles/tokens.css only.",
      px: "Raw px value '{{ value }}' is not allowed — use the spacing/radius scale (e.g. p-4, rounded-xl) instead of a Tailwind arbitrary value.",
    },
    schema: [],
  },
  create(context) {
    const report = (node, raw) => {
      const hexMatch = raw.match(HEX) || raw.match(ARBITRARY_HEX);
      if (hexMatch) {
        context.report({ node, messageId: 'hex', data: { value: hexMatch[0] } });
        return;
      }
      const pxMatch = raw.match(ARBITRARY_PX);
      if (pxMatch) {
        context.report({ node, messageId: 'px', data: { value: pxMatch[0] } });
      }
    };

    const check = (node, value) => {
      if (typeof value !== 'string') return;
      if (HEX.test(value) || ARBITRARY_HEX.test(value) || ARBITRARY_PX.test(value)) {
        report(node, value);
      }
    };

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

module.exports = {
  'no-raw-values': noRawValues,
};
