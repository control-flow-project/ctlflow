import { onboardingUrl } from '@ctlflow/crossfire-contracts/onboarding';
import { useSession } from './session.js';
import { operations, useResource } from './api.js';
import { CopyText, Loaded, Page, ViewNavigation } from './ui.js';
function SetupPicture({ step }: { step: number }) {
  return <svg className={'setup-picture setup-picture-' + step} viewBox="0 0 160 100" aria-hidden="true"><path d="M16 18h112v62H16z" fill="currentColor"/><path d="M28 30h112v62H28z" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2"/>
    {step === 1 ? <><path d="m44 48 10 8-10 8m22 0h34" fill="none" stroke="var(--ink)" strokeWidth="3"/><circle cx="126" cy="32" r="15" fill="currentColor"/><path d="m119 32 5 5 9-10" fill="none" stroke="var(--ink)" strokeWidth="2"/></>
      : step === 2 ? <><circle cx="62" cy="52" r="9" fill="currentColor"/><path d="M46 76q16-26 32 0m13-20 9 9 17-22" fill="none" stroke="var(--ink)" strokeWidth="3"/></>
        : <><circle cx="51" cy="54" r="8" fill="currentColor"/><path d="M70 47h47M70 60h32M46 77h72" stroke="var(--ink)" strokeWidth="2"/></>}
  </svg>;
}
function SetupTabs({ fleet }: { fleet: boolean }) {
  return <ViewNavigation label="Connection type" items={[{ label: 'One agent', href: '/manage/connect', current: !fleet }, { label: 'Fleet · advanced', href: '/manage/connect/fleet', current: fleet }]}/>;
}
export function Connect({ fleet = false }: { fleet?: boolean }) {
  const { member } = useSession(), release = useResource(operations.release, {});
  const guide = onboardingUrl(location.origin, member.matrixUserId);
  return <Page title={fleet ? 'Connect a fleet' : 'Connect an agent'} description={fleet ? 'Let a controller connect and manage several agents together.' : 'Bring the coding agent you already use into your conversations.'}>
    <SetupTabs fleet={fleet}/>
    {fleet ? <section className="setup-step"><div><h2>Configure the controller</h2><p>Fleets run on Linux. The controller connects every agent without model calls; one approval covers the roster.</p>
      <CopyText label="Coordination settings for runtime.toml" value={'[coordination]\nadapter = "crossfire"\nserver = ' + JSON.stringify(location.origin) + '\nowner = ' + JSON.stringify(member.matrixUserId)} buttonLabel="Copy fleet configuration" copiedMessage="Copied. Add to the fleet’s runtime.toml."/>
      <p>Run <code>fleet add /absolute/path/to/fleet</code>, then <code>fleet start FLEET_NAME</code>. Open the approval link shown by the CLI and confirm its code.</p>
      <p>Use the same start command later. Saved identities and sessions resume automatically. Starting a fleet creates no chats. Open a DM or invite an agent when you need it.</p><a href="/manage/fleets">View fleets →</a></div></section> : <>
      <section className="setup-step"><SetupPicture step={1}/><div><span className="step-label">STEP 1</span><h2>Paste one line into your coding agent</h2>
        <p>Open your project in Codex, Claude Code or Pi. Paste the line below. Your agent reads the guide, checks what it needs and connects this session.</p>
        <CopyText rows={2} label="Instructions for your agent" value={'Follow the setup instructions at ' + guide + '.'}/>
        <p className="support">First time? It asks what to call the agent. Reconnecting or updating? It finds and reuses the account saved privately in this project.</p></div></section>
      <section className="setup-step"><SetupPicture step={2}/><div><span className="step-label">STEP 2 · FIRST SETUP ONLY</span><h2>Approve your agent</h2>
        <p>Your agent gives you a private approval link and a verification code. Open the link, check the name and enter that code. Connection continues automatically.</p>
        <p>Approval creates its account, not a chat. Reconnecting an approved agent doesn’t require another approval.</p><a href="/manage/enrollments">Review enrollment requests →</a></div></section>
      <section className="setup-step"><SetupPicture step={3}/><div><span className="step-label">STEP 3 · YOUR CHOICE</span><h2>Choose where it can listen</h2>
        <p>See the reporting listener on your agent’s page. Your agent also runs a connection test without prompting the model.</p>
        <p>Open a DM with your agent in Element when you want to talk. That private conversation gets permanent read/write access automatically. Invite it to other rooms or assign access from its agent page.</p>
        <p>Wake-up rules decide whose messages trigger work. No chats are created at startup. A Codex approval request opens your private DM only when needed.</p>
        <div className="actions"><a className="button" href="/manage/agents">View agents →</a><a className="button" href="/">Open Element →</a></div></div></section>
    </>}
    <details className="setup-details"><summary>Requirements &amp; optional launcher</summary><p>Node.js 26+, Git, Bash and curl are required, with Codex 0.158.0+, Claude Code 2.1.285+ or Pi 0.99.1+. The guide helps your agent check prerequisites with your permission.</p>
      <p>Claude’s project hooks activate after its installation command finishes. Pi requires project trust and <code>/reload</code> for initial activation and native-module updates. The guide explains each runtime’s connection steps.</p>
      <p>Codex and Pi clients use Linux or macOS; the Claude adapter requires Linux process verification. Native verification uses Linux and inert providers, not paid models.</p>
      <p>Existing app-server-backed Codex sessions connect directly. Embedded or <code>--no-daemon</code> sessions must be reopened in native app-server mode; the guide explains how.</p>
      <Loaded {...release} retry={release.refresh}>{current => <p><a href={'/onboarding/' + current.data.release + '/runcodex.sh'} download="runcodex.sh">Download optional runcodex.sh</a> · Linux / macOS. It starts a private local server and a Codex terminal together. It is not needed for normal connection.</p>}</Loaded>
      <p>Run the downloaded script from your project with <code>bash /path/to/runcodex.sh</code> and your usual Codex options. Closing that terminal stops its private server.</p>
      <a href={guide}>Read the full guide for your account →</a>{member.roleCode === 'administrator' && <p><a href="/manage/policy">Edit instance onboarding instructions →</a></p>}
    </details>
  </Page>;
}
