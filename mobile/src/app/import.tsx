import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Upload,
  FileText,
  Check,
  ChevronDown,
  ChevronUp,
  Shield,
  Edit3,
  Trash2,
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';

import {
  parseCSV,
  generateImportPreview,
  CATEGORIES,
  type ParsedTransaction,
  type ImportPreview,
  type Category,
} from '@/lib/import-parser';
import { addTransaction, getTransactions } from '@/lib/db';

type ImportStep = 'upload' | 'preview' | 'success';

export default function ImportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<ImportStep>('upload');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  const pickFile = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      if (!file.uri) return;

      // Reject anything that's not a .csv. The picker's MIME filter is advisory
      // on iOS — users can still pick non-CSV files via "Browse" and we'd then
      // try to read a binary as text.
      const name = file.name?.toLowerCase() ?? '';
      if (!name.endsWith('.csv')) {
        Alert.alert(
          'Unsupported File',
          'Please pick a .csv file. PDFs, images, and other formats aren\'t supported yet.',
        );
        return;
      }

      // iOS sandbox: even with copyToCacheDirectory:true the URI can occasionally
      // point at a location readAsStringAsync cannot access. Verify the file
      // exists, and if not, copy explicitly into the app cache before reading.
      let readUri = file.uri;
      const info = await FileSystem.getInfoAsync(file.uri).catch(() => null);
      if (!info?.exists) {
        try {
          const cachePath = `${FileSystem.cacheDirectory}budget-import-${Date.now()}.csv`;
          await FileSystem.copyAsync({ from: file.uri, to: cachePath });
          readUri = cachePath;
        } catch (copyErr) {
          console.error('File copy fallback failed:', copyErr);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert(
            'Can\'t read this file',
            'iOS couldn\'t open the selected file. Try exporting from your bank again, or save it to Files first.',
          );
          return;
        }
      }

      // Read file content
      let content: string;
      try {
        content = await FileSystem.readAsStringAsync(readUri);
      } catch (readErr) {
        console.error('readAsStringAsync failed:', readErr);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          'Can\'t read this file',
          'The file is not readable. It may be a binary format (PDF, image) — only plain CSV is supported.',
        );
        return;
      }

      if (!content.trim()) {
        Alert.alert('Empty File', 'The selected file appears to be empty.');
        return;
      }

      // Parse CSV
      const parsedTransactions = parseCSV(content);

      if (parsedTransactions.length === 0) {
        Alert.alert(
          'No Transactions Found',
          'Could not parse any transactions from this file. Please ensure it\'s a valid CSV with date and amount columns.'
        );
        return;
      }

      // Get existing transactions for duplicate detection
      const existingTxs = await getTransactions();
      const existingKeys = new Set(
        existingTxs.map(tx => `${tx.dateISO}_${tx.amount}_${tx.note?.substring(0, 20) || ''}`)
      );

      // Generate preview
      const importPreview = generateImportPreview(parsedTransactions, existingKeys);
      setPreview(importPreview);
      setTransactions(importPreview.transactions);
      setStep('preview');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('File pick error:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to read the file. Please try again.');
    }
  }, []);

  const updateTransactionCategory = (txId: string, category: Category) => {
    setTransactions(prev =>
      prev.map(tx => (tx.id === txId ? { ...tx, suggestedCategory: category } : tx))
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleImpulse = (txId: string) => {
    setTransactions(prev =>
      prev.map(tx => (tx.id === txId ? { ...tx, isImpulse: !tx.isImpulse } : tx))
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const removeTransaction = (txId: string) => {
    setTransactions(prev => prev.filter(tx => tx.id !== txId));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const importTransactions = async () => {
    try {
      setImporting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      let count = 0;
      for (const tx of transactions) {
        await addTransaction({
          amount: tx.amount,
          category: tx.suggestedCategory,
          type: tx.type,
          isImpulse: tx.isImpulse,
          note: tx.description,
          dateISO: tx.date,
        });
        count++;
        setImportedCount(count);
      }

      // Invalidate queries to refresh data
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });

      setStep('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Import error:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Import Error', 'Some transactions failed to import. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

  return (
    <View className="flex-1 bg-[#0c0716]">
      {/* Header */}
      <LinearGradient
        colors={['#3b82f6', '#2563eb', '#1d4ed8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 20,
          paddingHorizontal: 16,
        }}
      >
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            className="w-10 h-10 rounded-full bg-white/20 items-center justify-center"
          >
            <ArrowLeft size={20} color="white" />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="text-white text-lg font-bold">Import Transactions</Text>
            <Text className="text-white/70 text-xs mt-1">
              {step === 'upload' ? 'Upload CSV' : step === 'preview' ? 'Review & Edit' : 'Complete'}
            </Text>
          </View>
          <View className="w-10" />
        </View>
      </LinearGradient>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* Security Notice */}
        <Animated.View entering={FadeInDown.duration(400)} className="px-4 pt-4">
          <View
            className="rounded-2xl p-4 flex-row items-start"
            style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', borderWidth: 1, borderColor: 'rgba(34, 197, 94, 0.2)' }}
          >
            <View className="w-10 h-10 rounded-xl bg-green-500/20 items-center justify-center mr-3">
              <Shield size={20} color="#22c55e" />
            </View>
            <View className="flex-1">
              <Text className="text-green-400 font-semibold mb-1">Your Data Stays Private</Text>
              <Text className="text-gray-400 text-xs leading-4">
                We do not store your banking credentials. Files are processed locally on your device
                and never uploaded to external servers.
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Upload Step */}
        {step === 'upload' && (
          <Animated.View entering={FadeInUp.delay(200).duration(400)} className="px-4 pt-6">
            <Pressable onPress={pickFile} className="active:scale-98">
              <View
                className="rounded-3xl p-8 items-center border-2 border-dashed"
                style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)' }}
              >
                <View className="w-20 h-20 rounded-3xl bg-blue-500/20 items-center justify-center mb-4">
                  <Upload size={36} color="#3b82f6" />
                </View>
                <Text className="text-white text-lg font-bold mb-2">Select CSV File</Text>
                <Text className="text-gray-400 text-sm text-center mb-4">
                  Upload a transaction export from your bank
                </Text>
                <View className="bg-blue-600 rounded-xl px-6 py-3">
                  <Text className="text-white font-semibold">Browse Files</Text>
                </View>
              </View>
            </Pressable>

            {/* Instructions */}
            <View className="mt-6">
              <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">HOW TO EXPORT FROM YOUR BANK</Text>
              <View className="gap-3">
                {[
                  'Log into your bank\'s website or app',
                  'Go to Transactions or Account History',
                  'Look for "Export" or "Download" option',
                  'Select CSV format and date range',
                  'Upload the downloaded file here',
                ].map((instruction, idx) => (
                  <View
                    key={idx}
                    className="rounded-xl p-3 flex-row items-center"
                    style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                  >
                    <View className="w-6 h-6 rounded-full bg-blue-500/20 items-center justify-center mr-3">
                      <Text className="text-blue-400 text-xs font-bold">{idx + 1}</Text>
                    </View>
                    <Text className="text-gray-300 text-sm flex-1">{instruction}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Supported Formats */}
            <View className="mt-6">
              <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">SUPPORTED FORMATS</Text>
              <View
                className="rounded-xl p-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <View className="flex-row items-center">
                  <FileText size={20} color="#6b7280" />
                  <Text className="text-gray-300 ml-3">CSV files (.csv)</Text>
                </View>
                <Text className="text-gray-500 text-xs mt-2">
                  Most banks support CSV export. The file should have columns for date, description, and amount.
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        {/* Preview Step */}
        {step === 'preview' && preview && (
          <Animated.View entering={FadeInUp.duration(400)} className="pt-4">
            {/* Summary */}
            <View className="px-4 mb-4">
              <View
                className="rounded-2xl p-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <Text className="text-gray-400 text-xs mb-3">IMPORT SUMMARY</Text>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-gray-400">Transactions</Text>
                  <Text className="text-white font-semibold">{transactions.length}</Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-gray-400">Total Expenses</Text>
                  <Text className="text-red-400 font-semibold">
                    {formatCurrency(transactions.filter(t => t.type === 'Expense').reduce((s, t) => s + t.amount, 0))}
                  </Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-gray-400">Total Income</Text>
                  <Text className="text-green-400 font-semibold">
                    {formatCurrency(transactions.filter(t => t.type === 'Income').reduce((s, t) => s + t.amount, 0))}
                  </Text>
                </View>
                {preview.duplicatesFound > 0 && (
                  <View className="flex-row justify-between">
                    <Text className="text-gray-400">Duplicates Skipped</Text>
                    <Text className="text-amber-400 font-semibold">{preview.duplicatesFound}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Transaction List */}
            <View className="px-4">
              <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">
                TRANSACTIONS ({transactions.length})
              </Text>
              {transactions.map((tx, idx) => (
                <Animated.View
                  key={tx.id}
                  entering={FadeInUp.delay(50 * Math.min(idx, 10)).duration(300)}
                >
                  <Pressable
                    onPress={() => setExpandedTx(expandedTx === tx.id ? null : tx.id)}
                    className="mb-2"
                  >
                    <View
                      className="rounded-xl p-4"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      {/* Main Row */}
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1 mr-3">
                          <Text className="text-white font-medium" numberOfLines={1}>
                            {tx.description}
                          </Text>
                          <View className="flex-row items-center mt-1">
                            <Text className="text-gray-500 text-xs">{tx.date}</Text>
                            <View className="w-1 h-1 rounded-full bg-gray-600 mx-2" />
                            <View className="bg-purple-500/20 rounded-full px-2 py-0.5">
                              <Text className="text-purple-400 text-xs">{tx.suggestedCategory}</Text>
                            </View>
                            {tx.isImpulse && (
                              <>
                                <View className="w-1 h-1 rounded-full bg-gray-600 mx-2" />
                                <View className="bg-pink-500/20 rounded-full px-2 py-0.5">
                                  <Text className="text-pink-400 text-xs">Impulse</Text>
                                </View>
                              </>
                            )}
                          </View>
                        </View>
                        <View className="items-end">
                          <Text className={`font-bold ${tx.type === 'Expense' ? 'text-red-400' : 'text-green-400'}`}>
                            {tx.type === 'Expense' ? '-' : '+'}{formatCurrency(tx.amount)}
                          </Text>
                          {expandedTx === tx.id ? (
                            <ChevronUp size={16} color="#6b7280" />
                          ) : (
                            <ChevronDown size={16} color="#6b7280" />
                          )}
                        </View>
                      </View>

                      {/* Expanded Edit Options */}
                      {expandedTx === tx.id && (
                        <Animated.View entering={FadeInDown.duration(200)} className="mt-4 pt-4 border-t border-gray-800">
                          {/* Category Selector */}
                          <Text className="text-gray-400 text-xs mb-2">CATEGORY</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                            <View className="flex-row gap-2">
                              {CATEGORIES.map(cat => (
                                <Pressable
                                  key={cat}
                                  onPress={() => updateTransactionCategory(tx.id, cat)}
                                >
                                  <View
                                    className={`rounded-full px-3 py-1.5 ${
                                      tx.suggestedCategory === cat
                                        ? 'bg-purple-600'
                                        : 'bg-gray-800'
                                    }`}
                                  >
                                    <Text
                                      className={`text-xs ${
                                        tx.suggestedCategory === cat
                                          ? 'text-white font-semibold'
                                          : 'text-gray-400'
                                      }`}
                                    >
                                      {cat}
                                    </Text>
                                  </View>
                                </Pressable>
                              ))}
                            </View>
                          </ScrollView>

                          {/* Action Buttons */}
                          <View className="flex-row gap-2 mt-4">
                            <Pressable
                              onPress={() => toggleImpulse(tx.id)}
                              className="flex-1"
                            >
                              <View
                                className={`rounded-xl p-3 flex-row items-center justify-center ${
                                  tx.isImpulse ? 'bg-pink-500/20' : 'bg-gray-800'
                                }`}
                              >
                                <Edit3 size={16} color={tx.isImpulse ? '#ec4899' : '#9ca3af'} />
                                <Text className={`ml-2 text-sm ${tx.isImpulse ? 'text-pink-400' : 'text-gray-400'}`}>
                                  {tx.isImpulse ? 'Impulse' : 'Mark Impulse'}
                                </Text>
                              </View>
                            </Pressable>
                            <Pressable onPress={() => removeTransaction(tx.id)}>
                              <View className="rounded-xl p-3 bg-red-500/20">
                                <Trash2 size={16} color="#ef4444" />
                              </View>
                            </Pressable>
                          </View>
                        </Animated.View>
                      )}
                    </View>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          </Animated.View>
        )}

        {/* Success Step */}
        {step === 'success' && (
          <Animated.View entering={FadeInUp.duration(400)} className="px-4 pt-8 items-center">
            <View className="w-24 h-24 rounded-full bg-green-500/20 items-center justify-center mb-6">
              <Check size={48} color="#22c55e" />
            </View>
            <Text className="text-white text-2xl font-bold mb-2">Import Complete!</Text>
            <Text className="text-gray-400 text-center mb-6">
              Successfully imported {importedCount} transactions into your budget tracker.
            </Text>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.replace('/(tabs)');
              }}
              className="w-full"
            >
              <LinearGradient
                colors={['#22c55e', '#16a34a']}
                style={{
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: 'center',
                }}
              >
                <Text className="text-white font-bold text-lg">Go to Dashboard</Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        )}
      </ScrollView>

      {/* Bottom Action Bar for Preview */}
      {step === 'preview' && transactions.length > 0 && (
        <View
          className="absolute bottom-0 left-0 right-0 px-4 pt-4 pb-2 border-t border-gray-800"
          style={{
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: '#0c0716',
          }}
        >
          <Pressable
            onPress={importTransactions}
            disabled={importing}
            className="active:scale-98"
          >
            <LinearGradient
              colors={importing ? ['#374151', '#374151'] : ['#3b82f6', '#2563eb']}
              style={{
                borderRadius: 16,
                paddingVertical: 16,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
              }}
            >
              {importing ? (
                <>
                  <ActivityIndicator size="small" color="white" />
                  <Text className="text-white font-bold text-lg ml-3">
                    Importing... ({importedCount}/{transactions.length})
                  </Text>
                </>
              ) : (
                <>
                  <Check size={20} color="white" />
                  <Text className="text-white font-bold text-lg ml-2">
                    Import {transactions.length} Transactions
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </View>
  );
}
