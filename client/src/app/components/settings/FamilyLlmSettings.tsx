import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsRow } from './SettingsRow';

interface FamilyLlmConfig {
  backend: string;
  model: string | null;
  hasKey: boolean;
}

interface FamilyLlmResponse {
  config: FamilyLlmConfig | null;
  instanceFallback: { enabled: boolean; backend?: string; scope: string } | null;
}

export function FamilyLlmSettings({ isOwner }: { isOwner: boolean }): JSX.Element {
  const { t } = useTranslation('settings');
  const [data, setData] = useState<FamilyLlmResponse | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void fetch('/api/family/llm', { credentials: 'same-origin', signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!ac.signal.aborted && body) setData(body as FamilyLlmResponse);
      })
      .catch(() => {
        if (!ac.signal.aborted) setData({ config: null, instanceFallback: null });
      });
    return () => ac.abort();
  }, []);

  const family = data?.config;
  const instance = data?.instanceFallback;
  const usingInstance = !family && Boolean(instance?.enabled);

  let description = t('family.llm.none');
  if (family) {
    description = t('family.llm.own', { backend: family.backend });
  } else if (usingInstance) {
    description = t('family.llm.instance', { backend: instance?.backend ?? 'server' });
  }

  return (
    <SettingsRow
      label={t('family.llm.label')}
      description={description}
      badge={family ? t('family.llm.badgeFamily') : t('family.llm.badgeInstance')}
      disabled={!isOwner && !family && !usingInstance}
    />
  );
}
