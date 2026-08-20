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
  parseStatement,
  detectCsvFormat,
  generateImportPreview,
  CATEGORIES,
  type ParsedTransaction,
  type ImportPreview,
  type Category,
  type ImportSource,
  parseCSV,
  inspectCsv,
  missingColumns,
  type CsvFormat,
  type CsvInspection,
  type ColumnMapping,
  type DateConvention,
  type SignConvention,
} from '@/lib/import-parser';
import { addTransaction, getTransactions, getSettings } from '@/lib/db';
import { findProfileFor, rememberProfile } from '@/lib/import-profiles';
import { useEntitlement } from '@/lib/useEntitlement';
import { isUpgradeRequired } from '@/lib/entitlementApi';
import { api } from '@/lib/api/api';

/** One transaction as returned by /api/ai/analyze-statement. */
interface StatementRow {
  dateISO: string;
  amount: number;
  type: 'Expense' | 'Income';
  category: string;
  note: string;
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'success';

export default function ImportScreen() {
  const { handleUpgradeRequired } = useEntitlement();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<ImportStep>('upload');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  // Kept so the preview can be re-parsed when the user corrects a convention
  // the detector guessed wrong.
  const [rawContent, setRawContent] = useState<string>('');
  const [rawSource, setRawSource] = useState<ImportSource>('bank');
  const [format, setFormat] = useState<CsvFormat | null>(null);

  // Manual column mapping, for files whose header we could not read.
  const [inspection, setInspection] = useState<CsvInspection | null>(null);
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});

  // The mapping actually used, remembered against this bank once the import
  // succeeds so the next statement from them needs no setup.
  const [activeMapping, setActiveMapping] = useState<ColumnMapping | null>(null);
  const [rememberedBank, setRememberedBank] = useState(false);
  const [analyzingPdf, setAnalyzingPdf] = useState(false);

  /**
   * Read a PDF statement via the vision model.
   *
   * Unlike CSV, this leaves the device — the file goes to our backend, which
   * proxies OpenAI. That is a real change in the privacy story for this screen,
   * so the user is told before it happens.
   */
  const importPdfStatement = useCallback(async (uri: string, filename: string) => {
    const proceed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Read this PDF with AI?',
        'CSV files are processed entirely on your device. A PDF has to be sent to our server to be read. ' +
          'It is used only to extract the transactions and is not stored.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Continue', onPress: () => resolve(true) },
        ],
      );
    });
    if (!proceed) return;

    setAnalyzingPdf(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const res = await api.post<{ transactions: StatementRow[] }>(
        '/api/ai/analyze-statement',
        { file: base64, filename },
      );

      const rows = res?.transactions ?? [];
      if (rows.length === 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          'Nothing readable in that PDF',
          'No transactions could be extracted. If your bank also offers CSV, that will always be more accurate.',
        );
        return;
      }

      const parsed: ParsedTransaction[] = rows.map((r, i) => ({
        id: `pdf_${Date.now()}_${i}`,
        date: r.dateISO,
        description: r.note,
        amount: r.amount,
        type: r.type,
        suggestedCategory: r.category,
        originalData: {},
        isImpulse: false,
      }));

      const existingTxs = await getTransactions();
      const existingKeys = new Set(
        existingTxs.map(tx => `${tx.dateISO}_${tx.amount}_${tx.note?.substring(0, 20) || ''}`),
      );
      const importPreview = generateImportPreview(parsed, existingKeys);

      setPreview(importPreview);
      setTransactions(importPreview.transactions);
      // A PDF has no column mapping or decimal convention to correct, so the
      // format controls stay hidden and nothing is remembered against a bank.
      setRawContent('');
      setRawSource('bank');
      setFormat(null);
      setActiveMapping(null);
      setRememberedBank(false);
      setStep('preview');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error('[import] PDF analysis failed:', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // A free user hitting the allowance should be offered the upgrade here,
      // not told the file was unreadable.
      if (await handleUpgradeRequired(e)) return;
      Alert.alert(
        isUpgradeRequired(e) ? 'Pro feature' : 'Could not read that PDF',
        isUpgradeRequired(e)
          ? 'Reading PDF statements uses AI. Upgrade to Pro in Settings, or import a CSV instead — CSV is parsed on your device and is always more accurate.'
          : e instanceof Error && /429/.test(e.message)
            ? 'You have hit the AI usage limit. Please try again later.'
            : 'The statement could not be analysed. If your bank offers CSV, that will always be more accurate.',
      );
    } finally {
      setAnalyzingPdf(false);
    }
  }, [handleUpgradeRequired]);

  const pickFile = useCallback(async (source: ImportSource = 'bank') => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'application/csv',
          // Many banks — especially outside the US — offer only PDF.
          ...(source === 'bank' ? ['application/pdf'] : []),
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      if (!file.uri) return;

      // The picker's MIME filter is advisory on iOS — users can still pick
      // anything via "Browse", and we would then read a binary as text.
      const name = file.name?.toLowerCase() ?? '';
      const isPdf = name.endsWith('.pdf');
      if (!name.endsWith('.csv') && !isPdf) {
        Alert.alert(
          'Unsupported File',
          'Please pick a .csv or .pdf statement. Other formats aren\'t supported yet.',
        );
        return;
      }

      if (isPdf) {
        if (source !== 'bank') {
          Alert.alert(
            'Unsupported File',
            'Alipay and WeChat bills must be exported as CSV, not PDF.',
          );
          return;
        }
        await importPdfStatement(file.uri, file.name ?? 'statement.pdf');
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

      // Most of the world writes the day first; only default to month-first
      // for users actually on USD. Detection overrides this whenever the file
      // proves its own ordering (any day past the 12th).
      const settings = await getSettings().catch(() => null);
      const fallbackDate: DateConvention =
        settings?.currency === 'USD' ? 'mdy' : 'dmy';

      let detected: CsvFormat | null = null;
      let usedMapping: ColumnMapping | null = null;
      let parsedTransactions: ParsedTransaction[];

      if (source === 'bank') {
        const found = inspectCsv(content, fallbackDate);

        // Have we seen this bank before? The shape of a statement belongs to
        // the bank, not the file, so anything already worked out (or corrected
        // by hand) applies again without asking.
        const remembered = await findProfileFor(found.headers).catch(() => null);

        if (remembered) {
          detected = remembered.format;
          usedMapping = remembered.mapping;
          parsedTransactions = parseCSV(content, remembered.format, remembered.mapping);
          setRememberedBank(true);
        } else if (found.missing.length > 0) {
          // A header we cannot read is a question, not a dead end.
          setRawContent(content);
          setRawSource(source);
          setInspection(found);
          setMapping({});
          setStep('mapping');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return;
        } else {
          detected = detectCsvFormat(content, fallbackDate);
          usedMapping = found.mapping;
          parsedTransactions = parseCSV(content, detected);
          setRememberedBank(false);
        }
      } else {
        // Alipay / WeChat bills have a fixed, known shape.
        parsedTransactions = parseStatement(content, source);
      }

      if (parsedTransactions.length === 0) {
        Alert.alert(
          'No Transactions Found',
          source === 'alipay' || source === 'wechat'
            ? 'Could not read this bill. Make sure you exported it as a UTF-8 CSV from ' +
              (source === 'alipay' ? 'Alipay (支付宝账单)' : 'WeChat Pay (微信账单)') +
              ' — the Chinese column headers must be intact.'
            : "Could not parse any transactions. Ensure it's a valid CSV with date and amount columns."
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
      setRawContent(content);
      setRawSource(source);
      setFormat(detected);
      setActiveMapping(usedMapping);
      setStep('preview');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('File pick error:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to read the file. Please try again.');
    }
  }, [importPdfStatement]);

  /**
   * Re-run the parse with a corrected convention. Detection is good but cannot
   * be certain — a file whose every day is 12 or lower gives no evidence of its
   * ordering, and an all-positive amount column gives none of its direction.
   */
  const applyFormat = useCallback(
    async (patch: Partial<CsvFormat>) => {
      if (!rawContent || !format) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const next = { ...format, ...patch };
      const reparsed = parseStatement(rawContent, rawSource, next);

      const existingTxs = await getTransactions();
      const existingKeys = new Set(
        existingTxs.map(tx => `${tx.dateISO}_${tx.amount}_${tx.note?.substring(0, 20) || ''}`)
      );
      const importPreview = generateImportPreview(reparsed, existingKeys);

      setFormat(next);
      setPreview(importPreview);
      setTransactions(importPreview.transactions);
    },
    [rawContent, rawSource, format]
  );

  /** Parse with the user's column mapping and move on to the preview. */
  const confirmMapping = useCallback(async () => {
    if (!rawContent || !inspection) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const merged = { ...inspection.mapping, ...mapping };
    const parsed = parseCSV(rawContent, {}, merged);

    if (parsed.length === 0) {
      Alert.alert(
        'Still nothing to import',
        'Those columns did not produce any transactions. Check that the date and amount columns are the right way round.'
      );
      return;
    }

    const existingTxs = await getTransactions();
    const existingKeys = new Set(
      existingTxs.map(tx => `${tx.dateISO}_${tx.amount}_${tx.note?.substring(0, 20) || ''}`)
    );
    const importPreview = generateImportPreview(parsed, existingKeys);

    setPreview(importPreview);
    setTransactions(importPreview.transactions);
    setFormat(detectCsvFormat(rawContent, undefined, merged));
    setActiveMapping(merged);
    setStep('preview');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [rawContent, inspection, mapping]);

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
          ...(tx.currency ? { currency: tx.currency } : {}),
        });
        count++;
        setImportedCount(count);
      }

      // Remember this bank's shape now that an import has actually succeeded —
      // including any correction the user made on the preview screen. Only
      // formats that produced data the user accepted are worth reusing.
      if (rawSource === 'bank' && activeMapping && format) {
        const headers = inspectCsv(rawContent).headers;
        await rememberProfile(headers, activeMapping, format).catch(() => {});
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
            <Text className="text-gray-400 text-xs font-semibold mb-3 ml-1">CHOOSE A SOURCE</Text>
            <View className="gap-3">
              {([
                { source: 'bank' as ImportSource, emoji: '🏦', title: 'Bank statement', sub: 'CIH, Attijariwafa, or any bank — export a CSV', color: '#3b82f6' },
                { source: 'alipay' as ImportSource, emoji: '💙', title: 'Alipay 支付宝', sub: 'Export your bill: Me → 账单 → export (UTF-8 CSV)', color: '#1677ff' },
                { source: 'wechat' as ImportSource, emoji: '💚', title: 'WeChat Pay 微信', sub: 'Me → Wallet → 账单 → 下载账单 (emailed CSV)', color: '#22c55e' },
              ]).map((s) => (
                <Pressable key={s.source} onPress={() => pickFile(s.source)}>
                  <View
                    className="rounded-2xl p-4 flex-row items-center"
                    style={{ backgroundColor: `${s.color}14`, borderWidth: 1, borderColor: `${s.color}33` }}
                  >
                    <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: `${s.color}22`, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                      <Text style={{ fontSize: 24 }}>{s.emoji}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-bold" style={{ fontSize: 15 }}>{s.title}</Text>
                      <Text className="text-gray-400 text-xs mt-0.5">{s.sub}</Text>
                    </View>
                    <Upload size={18} color={s.color} />
                  </View>
                </Pressable>
              ))}
            </View>

            <Text className="text-gray-500 text-xs mt-4 ml-1 leading-4">
              Alipay & WeChat Pay have no way to connect directly — this imports the bill you export from each app. For your bank, export a CSV statement from online banking.
            </Text>

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
                  Processed entirely on your device. If we can&apos;t recognise the columns,
                  you&apos;ll be asked to point them out — no file is ever a dead end.
                </Text>
                <View className="flex-row items-center mt-4">
                  <FileText size={20} color="#6b7280" />
                  <Text className="text-gray-300 ml-3">PDF statements (.pdf)</Text>
                </View>
                <Text className="text-gray-500 text-xs mt-2">
                  For banks that only offer PDF. Read by AI on our server, so it leaves your
                  device — we ask first. CSV is always more accurate where your bank offers it.
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        {/* Reading a PDF can take a while — say so rather than looking stuck. */}
        {analyzingPdf && (
          <View className="px-4 pt-6 items-center">
            <ActivityIndicator color="#3b82f6" />
            <Text className="text-gray-300 mt-3 font-semibold">Reading your statement…</Text>
            <Text className="text-gray-500 text-xs mt-1 text-center">
              A full page of transactions can take up to a minute.
            </Text>
          </View>
        )}

        {/* Mapping Step — shown only when the header could not be read */}
        {step === 'mapping' && inspection && (
          <Animated.View entering={FadeInUp.duration(400)} className="pt-4 px-4">
            <View
              className="rounded-2xl p-4 mb-4"
              style={{ backgroundColor: 'rgba(251,191,36,0.12)' }}
            >
              <Text className="text-amber-300 font-semibold mb-1">
                We couldn&apos;t read this file&apos;s columns
              </Text>
              <Text className="text-gray-300 text-xs leading-5">
                Tell us which column holds what and we&apos;ll take it from there. Your
                bank&apos;s wording is shown with a sample value from the file.
              </Text>
            </View>

            {([
              { key: 'dateIdx' as const, label: 'Date', required: true },
              { key: 'amountIdx' as const, label: 'Amount', required: true },
              { key: 'descIdx' as const, label: 'Description', required: false },
            ]).map(field => {
              const current = mapping[field.key] ?? inspection.mapping[field.key];
              return (
                <View key={field.key} className="mb-5">
                  <Text className="text-gray-400 text-xs font-semibold mb-2 ml-1">
                    {field.label.toUpperCase()}
                    {field.required ? ' (required)' : ' (optional)'}
                  </Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {inspection.headers.map((header, idx) => {
                      const active = current === idx;
                      const sample = inspection.sampleRows[0]?.[idx] ?? '';
                      return (
                        <Pressable
                          key={`${field.key}-${idx}`}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setMapping(m => ({ ...m, [field.key]: active ? -1 : idx }));
                          }}
                          className="rounded-xl px-3 py-2"
                          style={{
                            backgroundColor: active
                              ? 'rgba(59,130,246,0.22)'
                              : 'rgba(255,255,255,0.05)',
                            borderWidth: active ? 1 : 0,
                            borderColor: '#3b82f6',
                            minWidth: 104,
                          }}
                        >
                          <Text
                            numberOfLines={1}
                            className={active ? 'text-white font-semibold' : 'text-gray-300'}
                          >
                            {header || `Column ${idx + 1}`}
                          </Text>
                          {!!sample && (
                            <Text numberOfLines={1} className="text-gray-500 text-xs mt-0.5">
                              {sample}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            <Pressable
              onPress={confirmMapping}
              disabled={missingColumns({ ...inspection.mapping, ...mapping } as ColumnMapping).length > 0}
              className="rounded-xl py-4 items-center mt-2"
              style={{
                backgroundColor:
                  missingColumns({ ...inspection.mapping, ...mapping } as ColumnMapping).length > 0
                    ? 'rgba(255,255,255,0.08)'
                    : '#3b82f6',
              }}
            >
              <Text className="text-white font-semibold">
                {missingColumns({ ...inspection.mapping, ...mapping } as ColumnMapping).length > 0
                  ? 'Pick a date and an amount column'
                  : 'Continue'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setStep('upload');
                setInspection(null);
              }}
              className="rounded-xl py-3 items-center mt-2"
            >
              <Text className="text-gray-400">Choose a different file</Text>
            </Pressable>
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

            {/* Format controls — only for bank CSVs, whose conventions are
                inferred. Alipay/WeChat exports have a fixed, known shape. */}
            {format && rawSource === 'bank' && (
              <View className="px-4 mb-4">
                <View
                  className="rounded-2xl p-4"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                  <Text className="text-gray-400 text-xs mb-1">
                    {rememberedBank ? 'FILE FORMAT · REMEMBERED' : 'FILE FORMAT'}
                  </Text>
                  <Text className="text-gray-500 text-xs mb-3 leading-4">
                    {rememberedBank
                      ? 'Reusing the settings from your last import from this bank. Change them if anything looks wrong.'
                      : format.dateAmbiguous || format.signAmbiguous
                        ? 'We had to guess part of this. Check the dates and amounts below look right.'
                        : 'Detected from your file. Change these if anything looks wrong.'}
                  </Text>

                  <Text className="text-gray-400 text-xs mb-2">Date order</Text>
                  <View className="flex-row mb-4" style={{ gap: 8 }}>
                    {([
                      { value: 'dmy' as DateConvention, label: 'Day first', hint: '31/12/2026' },
                      { value: 'mdy' as DateConvention, label: 'Month first', hint: '12/31/2026' },
                    ]).map(opt => {
                      const active = format.date === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => applyFormat({ date: opt.value })}
                          className="flex-1 rounded-xl px-3 py-2"
                          style={{
                            backgroundColor: active ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                            borderWidth: active ? 1 : 0,
                            borderColor: '#3b82f6',
                          }}
                        >
                          <Text className={active ? 'text-white font-semibold' : 'text-gray-400'}>
                            {opt.label}
                          </Text>
                          <Text className="text-gray-500 text-xs mt-0.5">{opt.hint}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text className="text-gray-400 text-xs mb-2">Amounts are</Text>
                  <View className="flex-row" style={{ gap: 8 }}>
                    {([
                      { value: 'signed' as SignConvention, label: 'Signed', hint: '− is spending' },
                      { value: 'all-expense' as SignConvention, label: 'All spending', hint: 'every row out' },
                      { value: 'all-income' as SignConvention, label: 'All income', hint: 'every row in' },
                    ]).map(opt => {
                      const active = format.sign === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => applyFormat({ sign: opt.value })}
                          className="flex-1 rounded-xl px-3 py-2"
                          style={{
                            backgroundColor: active ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                            borderWidth: active ? 1 : 0,
                            borderColor: '#3b82f6',
                          }}
                        >
                          <Text
                            className={active ? 'text-white font-semibold text-xs' : 'text-gray-400 text-xs'}
                          >
                            {opt.label}
                          </Text>
                          <Text className="text-gray-500 text-xs mt-0.5">{opt.hint}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>
            )}

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
