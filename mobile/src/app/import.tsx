import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useState, useCallback } from 'react';
import { R, S, useC, type Palette } from '@/lib/design';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Edit3, FileText, Shield, Trash2, Upload } from '@/components/icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '@/components/motion';
import {
  Card,
  Empty,
  FilterChip,
  IconTile,
  LinkRow,
  PrimaryButton,
  Row,
  Screen,
  SectionHeader,
  SubHeader,
  Type,
} from '@/components/kit';
import { formatCurrency as money } from '@/lib/calculations';

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
  importHistory,
  preferHistory,
  type ImportHistory,
  type CsvFormat,
  type CsvInspection,
  type ColumnMapping,
  type DateConvention,
  type SignConvention,
} from '@/lib/import-parser';
import { addTransactions, getTransactions, getSettings } from '@/lib/db';
import { findProfileFor, rememberProfile } from '@/lib/import-profiles';
import { recordImportBatch, runDetection } from '@/lib/subscription-detection';
import { base64ToBytes, decodeStatementBytes } from '@/lib/text-decode';
import { useEntitlement } from '@/lib/useEntitlement';
import { isUpgradeRequired } from '@/lib/entitlementApi';
import { api } from '@/lib/api/api';
import { toApiFailure } from '@/lib/api-errors';
import { t } from '@/lib/i18n/core';
import { categoryLabel } from '@/lib/category-meta';
import { categoryIcon } from '@/components/category-icon';

/** One transaction as returned by /api/ai/analyze-statement. */
interface StatementRow {
  dateISO: string;
  amount: number;
  type: 'Expense' | 'Income';
  category: string;
  note: string;
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'success';

/** The three sources. Built per call: `t()` at module scope resolves once at
 *  import and freezes the startup language. */
function SOURCES(): readonly { source: ImportSource; title: string; sub: string }[] {
  return [
    { source: 'bank', title: t('import.sourceBank'), sub: t('import.sourceBankSub') },
    { source: 'alipay', title: t('import.alipayTitle'), sub: t('import.sourceAlipaySub') },
    { source: 'wechat', title: t('import.wechatTitle'), sub: t('import.sourceWechatSub') },
  ];
}

function MAPPING_FIELDS(): readonly {
  key: 'dateIdx' | 'amountIdx' | 'descIdx';
  label: string;
  required: boolean;
}[] {
  return [
    { key: 'dateIdx', label: t('import.colDate'), required: true },
    { key: 'amountIdx', label: t('import.colAmount'), required: true },
    { key: 'descIdx', label: t('import.colDescription'), required: false },
  ];
}

function DATE_OPTIONS(): readonly { value: DateConvention; label: string; hint: string }[] {
  return [
    { value: 'dmy', label: t('import.dayFirst'), hint: '31/12/2026' },
    { value: 'mdy', label: t('import.monthFirst'), hint: '12/31/2026' },
  ];
}

function SIGN_OPTIONS(): readonly { value: SignConvention; label: string; hint: string }[] {
  return [
    { value: 'signed', label: t('import.signed'), hint: t('import.signedHint') },
    { value: 'all-expense', label: t('import.allSpending'), hint: t('import.allSpendingHint') },
    { value: 'all-income', label: t('import.allIncome'), hint: t('import.allIncomeHint') },
  ];
}

/** A choice in a row of choices: a label, a sample beneath it, filled with
 *  the tint when chosen (the same "on" pair as FilterChip). Replaces four
 *  different blue-tinted bordered boxes. */
function OptionTile({
  pal,
  label,
  hint,
  active,
  onPress,
}: {
  pal: Palette;
  label: string;
  hint: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: 56,
        justifyContent: 'center',
        paddingHorizontal: 12,
        borderRadius: R.sm,
        borderCurve: 'continuous',
        backgroundColor: active ? pal.accent : pal.groundSunk,
      }}
    >
      <Type role="meta" color={active ? pal.onAccent : pal.ink} numberOfLines={1}>
        {label}
      </Type>
      <Type
        role="meta"
        color={active ? pal.onAccent : pal.inkDim}
        numberOfLines={1}
        style={{ opacity: active ? 0.7 : 1 }}
      >
        {hint}
      </Type>
    </PressableScale>
  );
}

export default function ImportScreen() {
  const C = useC();
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
  // What the user's own transactions say, read once per file: the rows already
  // in (skipped as duplicates), how they file each merchant, and their
  // currency, which picks the regional brands the keyword fallback knows
  // (Marjane in dirhams, Tesco in pounds). Every parse of the file gets it —
  // the re-parses too, or a corrected column would forget the history.
  const [history, setHistory] = useState<ImportHistory | null>(null);

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
        t('import.pdfConsentTitle'),
        t('import.pdfConsentBody'),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('common.continue'), onPress: () => resolve(true) },
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
          t('import.pdfEmptyTitle'),
          t('import.pdfEmptyBody'),
        );
        return;
      }

      const settings = await getSettings().catch(() => null);
      const known = importHistory(await getTransactions(), settings?.currency ?? null);
      const parsed: ParsedTransaction[] = rows.map((r, i) => ({
        id: `pdf_${Date.now()}_${i}`,
        date: r.dateISO,
        description: r.note,
        amount: r.amount,
        type: r.type,
        // The model only guesses; a merchant this user has filed before
        // goes where they filed it.
        suggestedCategory: preferHistory(r.note, r.category, known.context),
        originalData: {},
        isImpulse: false,
      }));

      const importPreview = generateImportPreview(parsed, known.existingKeys);

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
        isUpgradeRequired(e) ? t('subscription.proFeatureTitle') : t('import.pdfReadFailedTitle'),
        isUpgradeRequired(e)
          ? t('subscription.pdfProBody')
          : toApiFailure(e).kind === 'rateLimited'
            ? t('import.aiLimit')
            : t('import.pdfAnalyseFailed'),
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
          t('import.unsupportedTitle'),
          t('import.unsupportedBody'),
        );
        return;
      }

      if (isPdf) {
        if (source !== 'bank') {
          Alert.alert(
            t('import.unsupportedTitle'),
            t('import.cnPdfBody'),
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
            t('import.unreadableTitle'),
            t('import.iosOpenFailed'),
          );
          return;
        }
      }

      // Read the file's bytes and decode them as the bank wrote them: many
      // French and Moroccan banks export Windows-1252, Excel's "Unicode
      // text" is UTF-16, and reading everything as UTF-8 lost every accent
      // and euro sign (lib/text-decode.ts).
      let content: string;
      try {
        const base64 = await FileSystem.readAsStringAsync(readUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        content = decodeStatementBytes(base64ToBytes(base64)).text;
      } catch (readErr) {
        console.error('readAsStringAsync failed:', readErr);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          t('import.unreadableTitle'),
          t('import.unreadableBody'),
        );
        return;
      }

      if (!content.trim()) {
        Alert.alert(t('dialogs.emptyFile'), t('dialogs.emptyFileBody'));
        return;
      }

      // Most of the world writes the day first; only default to month-first
      // for users actually on USD. Detection overrides this whenever the file
      // proves its own ordering (any day past the 12th).
      const settings = await getSettings().catch(() => null);
      const fallbackDate: DateConvention =
        settings?.currency === 'USD' ? 'mdy' : 'dmy';
      // Read before the first parse, so it is categorised by the user's own
      // history and not only by the keyword table.
      const known = importHistory(await getTransactions(), settings?.currency ?? null);
      setHistory(known);

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
          parsedTransactions = parseCSV(content, remembered.format, remembered.mapping, known.context);
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
          parsedTransactions = parseCSV(content, detected, undefined, known.context);
          setRememberedBank(false);
        }
      } else {
        // Alipay / WeChat bills have a fixed, known shape.
        parsedTransactions = parseStatement(content, source, {}, known.context);
      }

      if (parsedTransactions.length === 0) {
        Alert.alert(
          t('import.noneFoundTitle'),
          source === 'alipay' || source === 'wechat'
            ? t('import.noneFoundCn', {
                source: source === 'alipay' ? 'Alipay (支付宝账单)' : 'WeChat Pay (微信账单)',
              })
            : t('import.noneFoundCsv')
        );
        return;
      }

      // Generate preview, skipping rows already in the app
      const importPreview = generateImportPreview(parsedTransactions, known.existingKeys);
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
      Alert.alert(t('common.error'), t('dialogs.readFailed'));
    }
  }, [importPdfStatement]);

  /**
   * Re-run the parse with a corrected convention. Detection is good but cannot
   * be certain — a file whose every day is 12 or lower gives no evidence of its
   * ordering, and an all-positive amount column gives none of its direction.
   */
  const applyFormat = useCallback(
    (patch: Partial<CsvFormat>) => {
      if (!rawContent || !format || !history) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const next = { ...format, ...patch };
      // A bank statement keeps the columns it was parsed with — remembered,
      // or pointed out by hand on the mapping step. Re-detecting them would
      // lose a mapping the header alone cannot give, and the preview would
      // come back empty.
      const reparsed =
        rawSource === 'bank' && activeMapping
          ? parseCSV(rawContent, next, activeMapping, history.context)
          : parseStatement(rawContent, rawSource, next, history.context);
      const importPreview = generateImportPreview(reparsed, history.existingKeys);

      setFormat(next);
      setPreview(importPreview);
      setTransactions(importPreview.transactions);
    },
    [rawContent, rawSource, format, history, activeMapping]
  );

  /** Parse with the user's column mapping and move on to the preview. */
  const confirmMapping = useCallback(() => {
    if (!rawContent || !inspection || !history) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const merged = { ...inspection.mapping, ...mapping };
    const parsed = parseCSV(rawContent, {}, merged, history.context);

    if (parsed.length === 0) {
      Alert.alert(
        t('import.stillNothingTitle'),
        t('import.stillNothingBody')
      );
      return;
    }

    const importPreview = generateImportPreview(parsed, history.existingKeys);

    setPreview(importPreview);
    setTransactions(importPreview.transactions);
    setFormat(detectCsvFormat(rawContent, undefined, merged));
    setActiveMapping(merged);
    setStep('preview');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [rawContent, inspection, mapping, history]);

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
    let count = 0;
    // The span the import's rows are written in: detection reads rows written
    // inside it as statement lines rather than hand entries.
    const startedAt = new Date().toISOString();
    try {
      setImporting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      // One batch write (db.ts addTransactions): row by row managed about four
      // rows a second, so a year of statements took minutes.
      await addTransactions(
        transactions.map((tx) => ({
          amount: tx.amount,
          category: tx.suggestedCategory,
          type: tx.type,
          isImpulse: tx.isImpulse,
          note: tx.description,
          dateISO: tx.date,
          ...(tx.currency ? { currency: tx.currency } : {}),
          origin: 'import' as const,
        })),
        (saved) => {
          count = saved;
          setImportedCount(saved);
        },
      );

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
      Alert.alert(t('dialogs.importError'), t('dialogs.importPartial'));
    } finally {
      setImporting(false);
      // Whatever was saved — all of it, or what got in before a failure —
      // is looked through for subscriptions now, without a Scan tap. The run
      // is serialised and never rejects; the success screen does not wait.
      if (count > 0) {
        void recordImportBatch(startedAt, new Date().toISOString()).then(() => runDetection('import'));
      }
    }
  };

  const mappingIncomplete =
    !inspection ||
    missingColumns({ ...inspection.mapping, ...mapping } as ColumnMapping).length > 0;

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: step === 'preview' ? 130 : 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <SubHeader
          pal={C}
          title={t('importExtra.title')}
          onBack={() => router.back()}
        />

        <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
          {step === 'upload'
            ? t('import.stepUpload')
            : step === 'preview'
              ? t('import.stepPreview')
              : t('import.stepComplete')}
        </Type>

        {/* Where the file goes, said once, in prose. It was a green-tinted
            card with a green-tinted icon well and a green heading — three
            things saying "safe" where one sentence does it. */}
        <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <IconTile pal={C}>
              <Shield size={19} color={C.ink} strokeWidth={S.stroke} />
            </IconTile>
            <View style={{ flex: 1 }}>
              <Type role="cardTitle" color={C.ink}>{t('importExtra.privateTitle')}</Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 4 }}>
                {t('import.credentialsNote')}
              </Type>
            </View>
          </View>
        </View>

        {/* ── Upload ─────────────────────────────────────────────────────── */}
        {step === 'upload' ? (
          <>
            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('importExtra.chooseSource')} />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {SOURCES().map((s, i) => (
                    <View
                      key={s.source}
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                    >
                      <LinkRow
                        pal={C}
                        icon={
                          <IconTile pal={C}>
                            <Upload size={19} color={C.ink} strokeWidth={S.stroke} />
                          </IconTile>
                        }
                        title={s.title}
                        body={s.sub}
                        onPress={() => pickFile(s.source)}
                        style={{ paddingVertical: 14 }}
                      />
                    </View>
                  ))}
                </Card>
                <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
                  {t('import.directNote')}
                </Type>
              </View>
            </View>

            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('import.supportedFormats')} />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={C}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <FileText size={18} color={C.inkDim} strokeWidth={S.stroke} />
                    <Type role="cardTitle" color={C.ink}>{t('import.csvTitle')}</Type>
                  </View>
                  <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                    {t('import.csvNote')}
                  </Type>

                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      marginTop: 16,
                    }}
                  >
                    <FileText size={18} color={C.inkDim} strokeWidth={S.stroke} />
                    <Type role="cardTitle" color={C.ink}>{t('import.pdfTitle')}</Type>
                  </View>
                  <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                    {t('import.pdfNote')}
                  </Type>
                </Card>
              </View>
            </View>
          </>
        ) : null}

        {/* Reading a PDF can take a while — say so rather than looking stuck. */}
        {analyzingPdf ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section, alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
            <Type role="cardTitle" color={C.ink} style={{ marginTop: 12 }}>
              {t('import.analysing')}
            </Type>
            <Type role="meta" color={C.inkDim} style={{ marginTop: 4, textAlign: 'center' }}>
              {t('import.analysingHint')}
            </Type>
          </View>
        ) : null}

        {/* ── Column mapping, only when the header could not be read ─────── */}
        {step === 'mapping' && inspection ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
            <Type role="section" color={C.ink}>{t('import.mappingTitle')}</Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
              {t('import.mappingHelp')}
            </Type>

            {MAPPING_FIELDS().map((field) => {
              const current = mapping[field.key] ?? inspection.mapping[field.key];
              return (
                <View key={field.key} style={{ marginTop: 24 }}>
                  <Type role="meta" color={C.inkDim} style={{ marginBottom: 12 }}>
                    {`${field.label} · ${field.required ? t('import.required') : t('import.optional')}`}
                  </Type>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {inspection.headers.map((header, idx) => {
                      const active = current === idx;
                      const sample = inspection.sampleRows[0]?.[idx] ?? '';
                      return (
                        <PressableScale
                          key={`${field.key}-${idx}`}
                          onPress={() =>
                            setMapping((m) => ({ ...m, [field.key]: active ? -1 : idx }))
                          }
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={header || t('import.columnN', { n: idx + 1 })}
                          style={{
                            minWidth: 108,
                            minHeight: 52,
                            justifyContent: 'center',
                            paddingHorizontal: 14,
                            borderRadius: R.sm,
                            borderCurve: 'continuous',
                            backgroundColor: active ? C.accent : C.groundSunk,
                          }}
                        >
                          <Type
                            role="meta"
                            color={active ? C.onAccent : C.ink}
                            numberOfLines={1}
                          >
                            {header || t('import.columnN', { n: idx + 1 })}
                          </Type>
                          {sample ? (
                            <Type
                              role="meta"
                              color={active ? C.onAccent : C.inkDim}
                              numberOfLines={1}
                              style={{ opacity: active ? 0.7 : 1 }}
                            >
                              {sample}
                            </Type>
                          ) : null}
                        </PressableScale>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            <PrimaryButton
              pal={C}
              label={mappingIncomplete ? t('import.pickColumns') : t('common.continue')}
              onPress={confirmMapping}
              disabled={mappingIncomplete}
              style={{ marginTop: 24 }}
            />
            <PressableScale
              onPress={() => {
                setStep('upload');
                setInspection(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('import.chooseDifferentFile')}
              style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}
            >
              <Type role="cardTitle" color={C.inkDim}>{t('import.chooseDifferentFile')}</Type>
            </PressableScale>
          </View>
        ) : null}

        {/* ── Preview ────────────────────────────────────────────────────── */}
        {step === 'preview' && preview ? (
          <>
            {/* Totals are figures, not movements, so they stay ink; the
                words beside them say which way the money went. The pinned
                import button is this step's one espresso anchor, so the
                summary stays a plain card. */}
            <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
              <Card pal={C}>
                <Type role="cardTitle" color={C.ink} style={{ marginBottom: 12 }}>
                  {t('import.summary')}
                </Type>
                {[
                  { label: t('importExtra.transactions'), value: String(transactions.length), tone: C.ink },
                  {
                    label: t('import.totalExpenses'),
                    value: money(
                      transactions.filter((x) => x.type === 'Expense').reduce((s, x) => s + x.amount, 0)
                    ),
                    tone: C.ink,
                  },
                  {
                    label: t('import.totalIncome'),
                    value: money(
                      transactions.filter((x) => x.type === 'Income').reduce((s, x) => s + x.amount, 0)
                    ),
                    tone: C.ink,
                  },
                  ...(preview.duplicatesFound > 0
                    ? [{
                        label: t('import.duplicatesSkipped'),
                        value: String(preview.duplicatesFound),
                        tone: C.inkDim,
                      }]
                    : []),
                ].map((line) => (
                  <View
                    key={line.label}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      gap: 12,
                      paddingVertical: 5,
                    }}
                  >
                    <Type role="body" color={C.inkDim}>{line.label}</Type>
                    <Type role="cardTitle" color={line.tone}>{line.value}</Type>
                  </View>
                ))}
              </Card>
            </View>

            {/* Format controls — only for bank CSVs, whose conventions are
                inferred. Alipay/WeChat exports have a fixed, known shape. */}
            {format && rawSource === 'bank' ? (
              <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
                <Card pal={C}>
                  <Type role="cardTitle" color={C.ink}>
                    {rememberedBank ? t('import.formatRemembered') : t('import.format')}
                  </Type>
                  <Type role="meta" color={C.inkDim} style={{ marginTop: 4 }}>
                    {rememberedBank
                      ? t('import.reusingSettings')
                      : format.dateAmbiguous || format.signAmbiguous
                        ? t('import.guessedSettings')
                        : t('import.detectedSettings')}
                  </Type>

                  <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
                    {t('import.dateOrder')}
                  </Type>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {DATE_OPTIONS().map((opt) => (
                      <OptionTile
                        key={opt.value}
                        pal={C}
                        label={opt.label}
                        hint={opt.hint}
                        active={format.date === opt.value}
                        onPress={() => applyFormat({ date: opt.value })}
                      />
                    ))}
                  </View>

                  <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
                    {t('import.amountsAre')}
                  </Type>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {SIGN_OPTIONS().map((opt) => (
                      <OptionTile
                        key={opt.value}
                        pal={C}
                        label={opt.label}
                        hint={opt.hint}
                        active={format.sign === opt.value}
                        onPress={() => applyFormat({ sign: opt.value })}
                      />
                    ))}
                  </View>
                </Card>
              </View>
            ) : null}

            <View style={{ marginTop: S.section }}>
              <SectionHeader
                pal={C}
                title={t('import.transactionCount', { count: transactions.length })}
              />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {transactions.map((tx, i) => {
                    const open = expandedTx === tx.id;
                    return (
                      <View
                        key={tx.id}
                        style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                      >
                        {/* A parsed transaction is money moving: kit Row
                            signs it and colours it green in / red out, and
                            marks the category by its glyph. */}
                        <Row
                          pal={C}
                          title={tx.description}
                          meta={[
                            tx.date,
                            categoryLabel(tx.suggestedCategory),
                            tx.isImpulse ? t('importExtra.impulse') : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          amount={tx.type === 'Expense' ? -tx.amount : tx.amount}
                          format={money}
                          icon={categoryIcon(tx.suggestedCategory, tx.type)}
                          onPress={() => setExpandedTx(open ? null : tx.id)}
                        />

                        {open ? (
                          <View style={{ paddingBottom: 16 }}>
                            <Type role="meta" color={C.inkDim} style={{ marginBottom: 8 }}>
                              {t('importExtra.category')}
                            </Type>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              style={{ flexGrow: 0 }}
                              contentContainerStyle={{ gap: 8 }}
                            >
                              {CATEGORIES.map((cat) => (
                                <FilterChip
                                  key={cat}
                                  pal={C}
                                  label={categoryLabel(cat)}
                                  active={tx.suggestedCategory === cat}
                                  onPress={() => updateTransactionCategory(tx.id, cat)}
                                />
                              ))}
                            </ScrollView>

                            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                              <PressableScale
                                onPress={() => toggleImpulse(tx.id)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: tx.isImpulse }}
                                accessibilityLabel={t('import.markImpulse')}
                                style={{
                                  flex: 1,
                                  minHeight: 44,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 8,
                                  borderRadius: R.pill,
                                  borderCurve: 'continuous',
                                  backgroundColor: tx.isImpulse ? C.accent : C.groundSunk,
                                }}
                              >
                                <Edit3
                                  size={15}
                                  color={tx.isImpulse ? C.onAccent : C.inkDim}
                                  strokeWidth={S.stroke}
                                />
                                <Type role="meta" color={tx.isImpulse ? C.onAccent : C.ink}>
                                  {tx.isImpulse ? t('import.impulse') : t('import.markImpulse')}
                                </Type>
                              </PressableScale>

                              <PressableScale
                                onPress={() => removeTransaction(tx.id)}
                                haptic="light"
                                accessibilityRole="button"
                                accessibilityLabel={t('dialogs.delete')}
                                style={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: R.pill,
                                  borderCurve: 'continuous',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  backgroundColor: C.groundSunk,
                                }}
                              >
                                <Trash2 size={16} color={C.negative} strokeWidth={S.stroke} />
                              </PressableScale>
                            </View>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </Card>
              </View>
            </View>
          </>
        ) : null}

        {/* ── Done ───────────────────────────────────────────────────────── */}
        {step === 'success' ? (
          <Empty
            pal={C}
            icon={<Check size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('importExtra.complete')}
            body={t('import.successBody', { count: importedCount })}
            actionLabel={t('importExtra.goToDashboard')}
            onAction={() => router.replace('/(tabs)')}
            style={{ marginTop: S.section }}
          />
        ) : null}
      </ScrollView>

      {/* The commit, pinned where a thumb is. */}
      {step === 'preview' && transactions.length > 0 ? (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: S.screen,
            paddingTop: 14,
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: C.ground,
            borderTopWidth: 1,
            borderTopColor: C.hairline,
          }}
        >
          <PrimaryButton
            pal={C}
            label={
              importing
                ? t('import.importing', { done: importedCount, total: transactions.length })
                : t('import.importCta', { count: transactions.length })
            }
            onPress={importTransactions}
            disabled={importing}
          />
        </View>
      ) : null}
    </Screen>
  );
}
