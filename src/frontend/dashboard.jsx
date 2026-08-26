import React, { useEffect, useState } from 'react';
import { render, Text, Button, Heading, Stack, SectionMessage, Textfield, DynamicTable } from '@forge/react';
import { invoke } from '@forge/bridge';

const usd = (n) => `$${Number(n ?? 0).toLocaleString('en-US')}`;

const RecommendationCard = ({ rec }) => {
  const [open, setOpen] = useState(false);
  const money = rec.money
    ? `${usd(Math.floor(rec.money.annualDeltaCents / 100))}/yr (${rec.money.realizationTiming.replaceAll('_', ' ').toLowerCase()})`
    : 'quote required';
  return (
    <Stack space="space.100">
      <Text size="small">
        **[{rec.risk.klass}]** {rec.what} - {money}{' '}
        <Button appearance="subtle" onClick={() => setOpen(!open)}>
          {open ? 'hide evidence' : 'why?'}
        </Button>
      </Text>
      {open && (
        <Stack space="space.050">
          <Text size="small">WHY: {rec.why.ruleId} ({rec.why.thresholdSummary})</Text>
          <Text size="small">{rec.why.detail}</Text>
          <Text size="small">RISK CHECKS:</Text>
          {rec.risk.checks.map((c, i) => (
            <Text key={i} size="small">
              {'  '}- {c.check}: {c.result}{c.detail ? ` (${c.detail})` : ''}
            </Text>
          ))}
          <Text size="small">EVIDENCE ({rec.evidence.length}):</Text>
          {rec.evidence.map((e, i) => (
            <Text key={i} size="small">
              {'  '}- [{e.kind}] {e.source}
              {e.observedAt ? ` @ ${e.observedAt}` : ''}
              {e.detail ? ` ${e.detail}` : ''}
            </Text>
          ))}
          {rec.money && (
            <Text size="small">
              MONEY: model={rec.money.pricingModelVersion} effective={rec.money.datasetEffectiveDate} before={rec.money.beforePosition}
              after={rec.money.afterPosition ?? 'n/a'}
              {(rec.money.crossings || []).length > 0
                ? ` BOUNDARY: ${rec.money.crossings.map((x) => x.description).join('; ')}`
                : ''}
              {rec.money.bounded ? '' : ` EXCLUDED PORTIONS: ${rec.money.unboundedReason ?? ''}`}
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
};

const Dashboard = () => {
  const [snap, setSnap] = useState(null);
  const [renewalInput, setRenewalInput] = useState('');
  const [exportText, setExportText] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      const s = await invoke('poll');
      if (!cancelled) setSnap(s);
      if (s.running) timer = setTimeout(tick, 2500);
    };
    (async () => {
      const s = await invoke('bootstrap');
      if (!cancelled) setSnap(s);
      if (s.running) timer = setTimeout(tick, 2500);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!snap || !snap.vm) {
    return (
      <Stack space="space.200">
        <Heading as="h2">Atlas - scanning your Atlassian seats</Heading>
        <Text>First scan in progress. Dollars appear here automatically; nothing to configure yet.</Text>
        <Text size="small">status: {snap?.status ?? 'QUEUED'} / phase: {snap?.phase ?? 'queued'}</Text>
      </Stack>
    );
  }

  const vm = snap.vm;
  const visibleRecs = snap.recommendations.filter(
    (r) => r.risk.klass === 'SAFE_NOW' || r.risk.klass === 'REVIEW',
  );

  return (
    <Stack space="space.300">
      {vm.showNonLiveBanner && (
        <SectionMessage title={vm.nonLiveBannerText} appearance="warning">
          <Text>
            This data comes from the deterministic sample-data transport. It is NOT a live scan of your site and must
            never be used for financial decisions.
          </Text>
        </SectionMessage>
      )}

      <Heading as="h1">ESTIMATED ANNUAL SAVINGS</Heading>
      <Text size="largest">{usd(vm.hero.displayDollars)} / year</Text>
      <Text size="medium">
        Safe now: {usd(vm.hero.split.safeNowDollars)} {'\u00b7'} Review pool: {usd(vm.hero.split.reviewPoolDollars)}
        {vm.hero.quoteRequiredCount > 0 ? ` \u00b7 quote-required items: ${vm.hero.quoteRequiredCount}` : ''}
      </Text>
      {vm.hero.boundedNote && <Text size="small">{vm.hero.boundedNote}</Text>}
      <Text size="small">{vm.scanStatusLine}</Text>

      {vm.isPartial && (
        <SectionMessage title="Partial scan \u2014 totals cover only completed streams" appearance="warning">
          {vm.partialReasons.map((r, i) => (
            <Text key={i} size="small">
              - {r}
            </Text>
          ))}
        </SectionMessage>
      )}
      {vm.pricing.staleWarning && (
        <SectionMessage title="Pricing staleness" appearance="warning">
          <Text>{vm.pricing.staleWarning}</Text>
        </SectionMessage>
      )}

      {!vm.renewalStrip.hasDate ? (
        <Stack space="space.100">
          <Text>{vm.renewalStrip.promptText}</Text>
          <Stack space="space.100" alignInline="start">
            <Textfield
              label="Next renewal date (YYYY-MM-DD)"
              name="renewal"
              value={renewalInput}
              onChange={(e) => setRenewalInput(e.target.value)}
            />
            <Button
              appearance="primary"
              onClick={async () => {
                const s = await invoke('setRenewalDate', { nextRenewalDate: renewalInput });
                setSnap({ ...s, running: false });
              }}
            >
              Set renewal date
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Text size="medium">
          Next renewal: {vm.renewalStrip.nextRenewalDate} (T-{vm.renewalStrip.daysToRenewal} days)
          {vm.renewalStrip.exposureNote ? ` \u2014 ${vm.renewalStrip.exposureNote}` : ''}
        </Text>
      )}

      <Heading as="h3">Per-product breakdown</Heading>
      <DynamicTable
        head={{ cells: [{ key: 'p', content: 'Product' }, { key: 's', content: 'Seats' }, { key: 'safe', content: 'Safe now $/yr' }, { key: 'rev', content: 'Review pool $/yr' }, { key: 'pos', content: 'Band/tier position' }, { key: 'bx', content: 'Boundary' }] }}
        rows={vm.productTable.map((p, i) => ({
          key: String(i),
          cells: [
            { content: p.product },
            { content: p.seatsLabel },
            { content: p.safeNowDollars === null ? '\u2014' : usd(p.safeNowDollars) },
            { content: p.reviewPoolDollars === null ? '\u2014' : usd(p.reviewPoolDollars) },
            { content: p.bandPosition ?? '\u2014' },
            { content: p.boundaryCallout ? '! boundary crossing' : '' },
          ],
        }))}
        emptyView={<Text>No per-product savings yet.</Text>}
      />

      <Heading as="h3">Recommendations</Heading>
      {visibleRecs.length === 0 && <Text>No SAFE NOW or REVIEW recommendations in this scan.</Text>}
      <Stack space="space.150">
        {visibleRecs.map((rec) => (
          <RecommendationCard key={rec.id} rec={rec} />
        ))}
      </Stack>
      <Text size="small">
        Collapsed by default: KEEP {vm.collapsedCounts.keep} {'\u00b7'} UNKNOWN {vm.collapsedCounts.unknown}
      </Text>

      <Stack space="space.100" alignInline="start">
        <Button onClick={async () => setExportText(await invoke('buildExport', { format: 'markdown' }).then((r) => r.content))}>
          Renewal action brief (Markdown)
        </Button>
        <Button onClick={async () => setExportText(await invoke('buildExport', { format: 'csv' }).then((r) => r.content))}>
          Export CSV
        </Button>
        <Button
          appearance="subtle"
          onClick={async () => {
            await invoke('rescan');
          }}
        >
          Rescan
        </Button>
      </Stack>
      {exportText && <Text size="small">{exportText}</Text>}
    </Stack>
  );
};

export const renderDashboard = render(<Dashboard />);
