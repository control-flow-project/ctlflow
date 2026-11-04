export function nativeModels() {
  return { models: ['fixture-model', 'fixture-selected', 'gpt-5.1', 'gpt-5.2', 'gpt-6.1-sol'].map((slug, priority) => ({
    slug, display_name: slug, description: 'Inert local native provider capability', default_reasoning_level: 'medium',
    supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max'].map(effort => ({ effort, description: effort })),
    shell_type: 'unified_exec', visibility: 'list', supported_in_api: true, priority,
    base_instructions: 'Inert local native verification. Do not contact external services.',
    upgrade: null, model_messages: null, include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false, include_apps_usage_instructions: false,
    default_reasoning_summary: 'none', support_verbosity: true, default_verbosity: 'low',
    apply_patch_tool_type: 'freeform', web_search_tool_type: 'text_and_image', truncation_policy: { mode: 'tokens', limit: 10000 },
    context_window: 272000, effective_context_window_percent: 95, experimental_supported_tools: [],
    input_modalities: ['text', 'image'], supports_search_tool: false,
  })) };
}
