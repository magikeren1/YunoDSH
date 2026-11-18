export function messageSource(message, relation = 'evidence') {
  return {
    guildId: message.guildId ?? null, channelId: String(message.channelId),
    messageId: String(message.id), authorId: String(message.author.id),
    at: Number(message.createdTimestamp), relation,
  };
}

export function mergeSources(previous = [], incoming = []) {
  const sources = new Map();
  for (const source of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!source || typeof source.channelId !== 'string' || typeof source.messageId !== 'string'
      || typeof source.authorId !== 'string' || !Number.isFinite(source.at)) continue;
    sources.set(`${source.channelId}:${source.messageId}:${source.relation ?? 'evidence'}`, {
      guildId: source.guildId ?? null, channelId: source.channelId, messageId: source.messageId,
      authorId: source.authorId, at: source.at, relation: source.relation ?? 'evidence',
    });
  }
  return [...sources.values()].slice(-100);
}
