// Pure passive-history coverage helpers, shared by the background and reader.
// Separate responses join only through a shared message ID, never elapsed time alone.
function mergeHistoryRuns(runs = [], messages = []) {
  const result = runs.map((run) => ({ ...run, ids: [...run.ids] }));
  const channels = new Map();
  for (const message of messages) {
    const at = Date.parse(message.timestamp);
    if (!message.id || !message.channel_id || !Number.isFinite(at)) continue;
    if (!channels.has(message.channel_id)) channels.set(message.channel_id, []);
    channels.get(message.channel_id).push({ id: message.id, at });
  }
  for (const [channelId, batch] of channels) {
    const ids = new Set(batch.map((message) => message.id));
    let from = Math.min(...batch.map((message) => message.at));
    let to = Math.max(...batch.map((message) => message.at));
    // Revisit after every merge so a bridging page can connect several prior runs.
    let merged;
    do {
      merged = false;
      for (let i = result.length - 1; i >= 0; i--) {
        const run = result[i];
        if (run.channelId !== channelId || !run.ids.some((id) => ids.has(id))) continue;
        from = Math.min(from, run.from); to = Math.max(to, run.to);
        for (const id of run.ids) ids.add(id);
        result.splice(i, 1); merged = true;
      }
    } while (merged);
    result.push({ channelId, from, to, ids: [...ids] });
  }
  return result;
}

function coverGap(gap, runs) {
  const covered = { ...gap.covered };
  for (const run of runs) {
    if (run.from <= gap.from && run.to >= gap.to) covered[run.channelId] = true;
  }
  return { ...gap, covered };
}

function isGapCovered(gap, channelIds) {
  return channelIds.every((id) => gap.covered?.[id] === true);
}

function recoveryTargets(gap, collections, channels) {
  // Jumping to a synthetic snowflake is unverified against Discord; test live.
  const snowflake = ((BigInt(Math.trunc(gap.to)) - 1420070400000n) << 22n).toString();
  // Match the reader: categories and threads are not independently selectable.
  const excluded = new Set([4, 10, 11, 12]);
  return Object.values(channels).filter((channel) => channel.guild_id && !excluded.has(channel.type)
    && !gap.covered?.[channel.id] && collections.some((collection) => collection.all
      || collection.ids?.includes(channel.id) || collection.ids?.includes(channel.parent_id)))
    .map((channel) => ({ channelId: channel.id, guildId: channel.guild_id,
      url: `https://discord.com/channels/${channel.guild_id}/${channel.id}/${snowflake}` }));
}

if (typeof module !== 'undefined') module.exports = { mergeHistoryRuns, coverGap, isGapCovered, recoveryTargets };
