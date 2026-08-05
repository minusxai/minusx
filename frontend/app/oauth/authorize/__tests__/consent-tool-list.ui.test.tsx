/**
 * The consent screen must name every tool the grant covers.
 *
 * It shipped with its own hardcoded array of five names while the server registered six, so a
 * user with a Context Library was shown a smaller grant than they were approving — the omitted
 * tool being `LoadContext`, which reads their documents. Under-describing a grant is the one
 * failure mode a consent screen cannot have.
 *
 * The screen now renders `MCP_TOOLS` rather than a list of its own, so this asserts the wiring
 * holds: every manifest entry reaches the DOM, including the conditional one. Whether the manifest
 * itself matches the server is pinned separately, against a real server, in
 * `lib/mcp/__tests__/tool-manifest.e2e.test.ts`.
 */

import { screen } from '@testing-library/react';
import { makeStore } from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import OAuthConsentForm from '@/app/oauth/authorize/consent-form';
import { MCP_TOOLS } from '@/lib/mcp/tool-manifest';

function render() {
  return renderWithProviders(
    <OAuthConsentForm
      clientOrigin="https://claude.ai"
      userName="Test User"
      userEmail="test@example.com"
      companyName="Acme"
      redirectUri="https://claude.ai/callback"
      codeChallenge="abc"
      codeChallengeMethod="S256"
    />,
    { store: makeStore() }
  );
}

describe('OAuth consent screen — tool list', () => {
  it('names every tool in the manifest', () => {
    render();

    for (const { name } of MCP_TOOLS) {
      expect(screen.getByLabelText(`Granted tool ${name}`)).toBeInTheDocument();
    }
  });

  it('names the conditional tools too, because the grant covers them', () => {
    // A session only exposes LoadContext when the user has on-demand docs, but the token
    // authorizes the whole surface — which is what the user is approving here.
    const conditional = MCP_TOOLS.filter((t) => t.conditional);
    expect(conditional.length).toBeGreaterThan(0);

    render();

    for (const { name } of conditional) {
      expect(screen.getByLabelText(`Granted tool ${name}`)).toBeInTheDocument();
    }
  });

  it('shows no tool the manifest does not list', () => {
    render();

    const rendered = screen
      .getAllByLabelText(/^Granted tool /)
      .map((el) => el.getAttribute('aria-label')!.replace('Granted tool ', ''));

    expect(rendered.sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });
});
