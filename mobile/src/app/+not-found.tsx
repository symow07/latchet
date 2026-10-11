import { Link, Stack } from 'expo-router';
import { View } from 'react-native';
import { S, useC } from '@/lib/design';
import { Type } from '@/components/kit';
import { t } from '@/lib/i18n/core';

/** The plain page, an ink headline and an accent link home. */
export default function NotFoundScreen() {
  const C = useC();
  return (
    <>
      <Stack.Screen options={{ title: t('errors.notFound') }} />
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: S.screen,
          backgroundColor: C.ground,
        }}
      >
        <Type role="section" color={C.ink} style={{ textAlign: 'center' }}>
          {t('errors.screenMissing')}
        </Type>

        <Link href="/" style={{ marginTop: 16, paddingVertical: 16 }}>
          <Type role="meta" color={C.accent}>{t('common.goHome')}</Type>
        </Link>
      </View>
    </>
  );
}
