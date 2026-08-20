import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { t } from '@/lib/i18n/core';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View className="flex-1 items-center justify-center bg-white p-5 dark:bg-black">
        <Text className="text-xl font-bold text-black dark:text-white">
          This screen doesn't exist.
        </Text>

        <Link href="/" className="mt-4 py-4">
          <Text className="text-sm text-blue-500">{t('common.goHome')}</Text>
        </Link>
      </View>
    </>
  );
}
