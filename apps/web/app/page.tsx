import Link from 'next/link';
import { IconLock, IconShield, IconVault } from '@/components/icons';
import {
  AllowanceMeter,
  Balance,
  ButtonLink,
  Eyebrow,
  Row,
  Wordmark,
} from '@/components/ui/primitives';

// S1 landing (docs/DESIGN.md §11 S1). Static: no API, no wallet, nothing that can move money.
// The balance card is an EXAMPLE and says so; it is not read from anywhere.
export default function Landing() {
  return (
    <>
      <header className="glass sticky top-0 z-30 h-14">
        <div className="mx-auto flex h-full max-w-[440px] items-center justify-between px-4">
          <Wordmark />
          <Link
            href="/connect"
            className="inline-flex min-h-11 items-center rounded-full px-3 text-small font-semibold text-accent-ink hover:underline"
          >
            Connect
          </Link>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[440px] pb-16 outline-none">
        <section className="px-4 pt-10">
          <h1 className="text-h1 font-bold tracking-[-0.015em] text-ink">
            The self-driving treasury that can&apos;t run off with the money.
          </h1>
          <p className="max-w-[46ch] pt-4 text-body text-muted">
            Write the mandate in plain English. Steward keeps the rest.
          </p>
          <div className="pt-6">
            <ButtonLink href="/connect">Connect wallet</ButtonLink>
          </div>
          <p className="pt-3 text-center">
            <a
              href="#how"
              className="inline-flex min-h-11 items-center text-small font-semibold text-info hover:underline"
            >
              Read how the fence works
            </a>
          </p>
        </section>

        <section className="px-4 pt-8" aria-label="Example treasury">
          <div className="glass rounded-lg p-5">
            <p className="flex items-center justify-between font-mono text-label font-semibold tracking-[0.12em] text-faint uppercase">
              <span>Treasury</span>
              <span>Example</span>
            </p>
            <p className="pt-2">
              <Balance base={12_480_000_000n} />
            </p>
            <div className="pt-5">
              <AllowanceMeter usedPct={24} capPct={78} caption="2,400 USDC of 10,000 used today" />
            </div>
          </div>
        </section>

        <section id="how" className="pt-4">
          <Eyebrow>How the fence works</Eyebrow>
          <Row
            icon={IconVault}
            title="Reasoning proposes"
            sub="Steward suggests a move. It has no keys and no way to send anything."
          />
          <Row
            icon={IconShield}
            title="The policy engine disposes"
            sub="Plain code checks every move against your rules. If a rule fails, nothing happens."
          />
          <Row
            icon={IconLock}
            title="A spend permission caps it"
            sub="Your wallet limits what Steward can ever pull, and you can revoke it at any time."
          />
        </section>

        <p className="px-4 pt-8 text-center text-small text-faint">Steward runs on Base Sepolia.</p>
      </main>
    </>
  );
}
