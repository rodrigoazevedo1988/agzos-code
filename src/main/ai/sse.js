async function* parseSSE(stream) {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = null;
  let data = [];
  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        if (data.length) yield { event, data: data.join('\n') };
        event = null;
        data = [];
      } else if (!line.startsWith(':')) {
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        let value = separator < 0 ? '' : line.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        if (field === 'data') data.push(value);
      }
    }
  }
}
module.exports = { parseSSE };
