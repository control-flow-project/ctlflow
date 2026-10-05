import { onboardingUrl } from '@ctlflow/crossfire-contracts/onboarding';
import { useSession } from './session.js';
import { CopyText, Page } from './ui.js';
function SetupPicture({ step }: { step: number }) {
  return <svg className={'setup-picture setup-picture-' + step} viewBox="0 0 160 100" aria-hidden="true"><path d="M16 18h112v62H16z" fill="currentColor"/><path d="M28 30h112v62H28z" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2"/>
    {step === 1 ? <><path d="m44 48 10 8-10 8m22 0h34" fill="none" stroke="var(--ink)" strokeWidth="3"/><circle cx="126" cy="32" r="15" fill="currentColor"/><path d="m119 32 5 5 9-10" fill="none" stroke="var(--ink)" strokeWidth="2"/></>
      : step === 2 ? <><circle cx="62" cy="52" r="9" fill="currentColor"/><path d="M46 76q16-26 32 0m13-20 9 9 17-22" fill="none" stroke="var(--ink)" strokeWidth="3"/></>
        : <><circle cx="51" cy="54" r="8" fill="currentColor"/><path d="M70 47h47M70 60h32M46 77h72" stroke="var(--ink)" strokeWidth="2"/></>}
  </svg>;
}
export function Connect() {
  const { member } = useSession(), guide = onboardingUrl(location.origin, member.matrixUserId);
  return <Page title="Set up an agent" description="Create a managed Codex agent in your project. One agent or several, setup follows the same steps.">
    <section className="setup-step" aria-labelledby="setup-instruction"><SetupPicture step={1}/><div><span className="step-label">STEP 1</span><h2 id="setup-instruction">Paste this into your coding assistant</h2>
      <p>Open the project you want the new agent to work in. Your assistant reads the guide and runs setup with saved defaults—no configuration questions.</p>
      <CopyText rows={2} label="Instructions for your agent" value={'Follow the setup instructions at ' + guide + '.'}/>
      <p className="support">Setup starts or reuses a private fleet controller. It creates a separate managed conversation; your current coding session stays independent.</p></div></section>
    <section className="setup-step" aria-labelledby="setup-approval"><SetupPicture step={2}/><div><span className="step-label">STEP 2 · FIRST SETUP ONLY</span><h2 id="setup-approval">Approve the enrollment</h2>
      <p>Open the approval link printed during setup. Check the roster and enter its matching verification code. Setup waits for your approval and continues automatically.</p>
      <p>Repeated setup reuses the fleet, identities and saved histories. Approval alone creates no chats or room access.</p><a href="/manage/enrollments">Review enrollment requests →</a></div></section>
    <section className="setup-step" aria-labelledby="setup-ready"><SetupPicture step={3}/><div><span className="step-label">STEP 3</span><h2 id="setup-ready">Choose where your agent works</h2>
      <p>Setup checks controller, listener and native-session readiness without calling the model. Your agent appears in Agents and its fleet.</p>
      <p>Open a DM in Element when you need it, or invite it to an existing room. Room access controls what it can read or send; wake eligibility controls whose messages trigger work.</p>
      <p>Agents sleep after the configured idle period and resume their saved histories for eligible messages. Stopped sessions stay stopped until you explicitly resume them.</p>
      <div className="actions"><a className="button" href="/manage/agents">View agents →</a><a className="button" href="/manage/fleets">View fleets →</a><a className="button" href="/">Open Element →</a></div></div></section>
    <details className="setup-details"><summary>Requirements &amp; advanced configuration</summary>
      <p>The guide checks Node.js, npm and Codex, with installation and native login steps if anything is missing. Packages install privately; setup does not require sudo or a global service.</p>
      <p>Codex is the supported runtime. The controller runs on Linux or macOS. Provider authentication uses Codex’s native login, never passwords or tokens pasted into chat.</p>
      <p><code>fleet setup</code> uses the current project and persisted defaults. An optional configuration file supplies explicit overrides through the same setup path. Model and effort use the native defaults unless configured.</p>
      <p>New agents default to <code>danger-full-access</code> and <code>on-request</code> approvals, without approval bypass. Review the requested scope before approving.</p>
      <p>Native histories survive stop and resume. Starting with fresh history is an explicit, confirmed operation; it is never a reconnect fallback.</p>
      <a href={guide}>Read the full guide for your account →</a>{member.roleCode === 'administrator' && <p><a href="/manage/policy">Edit instance onboarding instructions →</a></p>}
    </details>
  </Page>;
}
