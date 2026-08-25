import { Link, Stack } from 'expo-router';
import { useC } from '@/lib/design';
import { Text, View } from 'react-native';
import { t } from '@/lib/i18n/core';

export default function NotFoundScreen() {
  const C = useC();
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View className="flex-1 items-center justify-center bg-white p-5 dark:bg-black">
        <Text style={{ color: C.text }} className="text-xl font-bold dark:text-white">
          This screen doesn't exist.
        </Text>

        <Link href="/" className="mt-4 py-4">
          <Text className="text-sm text-blue-500">{t('common.goHome')}</Text>
        </Link>
      </View>
    </>
  );
}
