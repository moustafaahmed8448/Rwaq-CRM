import io

path = 'src/app/page.tsx'
c = io.open(path, encoding='utf-8').read()
lines = c.split('\n')

start_idx = 2179  # line 2180
end_idx = 2346    # line 2347

# stage-panel is at lines 2272-2309 (0-indexed 2271-2308)
# location-panel is at lines 2310-2346 (0-indexed 2309-2345)
stage_panel = lines[2271:2309]
loc_panel = lines[2309:2346]

new_block = [
    '      <div className="dashboard-grid-2 stage-location-grid">',
]
new_block.extend(stage_panel)
new_block.extend(loc_panel)
new_block.append('      </div>')
new_block.append('')
new_block.append('      {/* Channel performance panel */}')
new_block.append('      <section className="panel channel-performance-panel">')
new_block.append('        <div className="panel-heading">')
new_block.append('          <h3>{t("channel.performance")}</h3>')
new_block.append('          <span className="muted" style={{ fontSize: 11 }}>{t("channel.clients", { n: periodTotal })}</span>')
new_block.append('        </div>')
new_block.append('        {Object.entries(channelOutcomes ?? {}).length === 0 && (')
new_block.append('          <div className="empty-state">{t("channel.noData")}</div>')
new_block.append('        )}')
new_block.append('        <div className="channel-rows">')
new_block.append('          {Object.entries(channelOutcomes ?? {})')
new_block.append('            .sort((a, b) => b[1].total - a[1].total)')
new_block.append('            .map(([channel, row]) => (')
new_block.append('')
new_block.append('              <button')
new_block.append('                key={channel}')
new_block.append('                type="button"')
new_block.append('                className="channel-row"')
new_block.append('                onClick={() => setDashFilter("channel", [channel])}')
new_block.append('                title={t("channel.clickFilter")}')
new_block.append('              >')
new_block.append('                <span className="channel-name">')
new_block.append('                  <i className="dot" style={{ background: optionColor("channels", channel, colors) }} />')
new_block.append('                  {channelLabel(t, channel)}')
new_block.append('                </span>')
new_block.append('                <span className="channel-share">')
new_block.append('                  {Math.round((row.total / periodTotal) * 100)}% {t("channel.share")}')
new_block.append('                </span>')
new_block.append('                <span className="channel-stack" aria-label={t("roi.breakdown", {')
new_block.append('                  won: row.won, lost: row.lost, waiting: row.waiting,')
new_block.append('                  other: Math.max(0, row.total - row.won - row.lost - row.waiting), cpa: String.fromCharCode(8217),')
new_block.append('                })}>')
new_block.append('                  <i className="loc-stack-won" style={{ width: row.total ? (row.won / row.total) * 100 : 0 }} />')
new_block.append('                  <i className="loc-stack-lost" style={{ width: row.total ? (row.lost / row.total) * 100 : 0 }} />')
new_block.append('                  <i className="loc-stack-waiting" style={{ width: row.total ? (row.waiting / row.total) * 100 : 0 }} />')
new_block.append('                  <i className="loc-stack-other" style={{ width: row.total ? Math.max(0, row.total - row.won - row.lost - row.waiting) / row.total * 100 : 0 }} />')
new_block.append('                </span>')
new_block.append('                <span className="channel-counts">')
new_block.append('                  {t("channel.outcomes", { won: row.won, lost: row.lost, waiting: row.waiting })}')
new_block.append('                  <strong>{num(row.total)}</strong>')
new_block.append('                </span>')
new_block.append('              </button>')
new_block.append('            )))')
new_block.append('        </div>')
new_block.append('      </section>')

new_lines = lines[:start_idx] + new_block + lines[end_idx+1:]
c2 = '\n'.join(new_lines)
io.open(path, 'w', encoding='utf-8').write(c2)
print('Done. Replaced lines', start_idx+1, '-', end_idx+1)
print('New total lines:', len(new_lines))