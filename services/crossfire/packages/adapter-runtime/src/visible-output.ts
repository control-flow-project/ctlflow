import { object } from '@ctlflow/crossfire-contracts/validation';

export function visibleOutput(value: unknown, runtime: 'claude' | 'pi'): { id: string; text: string }[] {
  const record = object(value);
  if (!record.ok || runtime === 'pi' && record.value.type !== 'message') return [];
  const message = object(record.value.message);
  if (!message.ok) return [];
  const content = message.value.content;
  const id = record.value.uuid ?? record.value.id;
  if (typeof id !== 'string' || !id) return [];
  const parts: string[] = [];
  if (message.value.role === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      const part = object(block);
      if (!part.ok) continue;
      if (part.value.type === 'text' && typeof part.value.text === 'string') parts.push(part.value.text);
      if (runtime === 'claude' && part.value.type === 'tool_use') parts.push(JSON.stringify({ tool: part.value.name, input: part.value.input }));
    }
  } else if (runtime === 'claude' && message.value.role === 'user' && Array.isArray(content)) {
    for (const block of content) {
      const part = object(block);
      if (part.ok && part.value.type === 'tool_result') {
        if (typeof part.value.content === 'string') parts.push(part.value.content);
        else if (Array.isArray(part.value.content)) for (const block of part.value.content) {
          const result = object(block); if (result.ok && result.value.type === 'text' && typeof result.value.text === 'string') parts.push(result.value.text);
        }
      }
    }
  } else if (runtime === 'pi' && message.value.role === 'toolResult' && Array.isArray(content)) {
    for (const block of content) { const part = object(block); if (part.ok && part.value.type === 'text' && typeof part.value.text === 'string') parts.push(part.value.text); }
  }
  return parts.filter(Boolean).map((text, index) => ({ id: id + ':' + index, text }));
}
