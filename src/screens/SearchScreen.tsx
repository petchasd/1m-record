/**
 * Search — type an email, look it up, see how long it took.
 *
 * The connection is opened once and kept open for the screen's lifetime, so
 * every search after the first measures only the query itself, not connection
 * setup — the same thing a real app would do.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { DB } from '@op-engineering/op-sqlite';

import { countProfiles, findByEmail, openProfiles } from '../db/device';
import { emailForId } from '../db/rowgen';
import type { Profile } from '../db/schema';

interface SearchResult {
  email: string;
  ms: number;
  profile: Profile | null;
  useIndex: boolean;
}

/** Always seconds, with enough decimals to show a sub-millisecond query. */
const fmtSeconds = (ms: number): string => `${(ms / 1000).toFixed(6)} วินาที`;

export const SearchScreen = (): React.JSX.Element => {
  const dbRef = useRef<DB | null>(null);
  const [rows, setRows] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [useIndex, setUseIndex] = useState(true);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const db = openProfiles();
      dbRef.current = db;
      setRows(countProfiles(db));
    } catch (e) {
      setOpenError(String(e));
    }
    return () => {
      dbRef.current?.close();
      dbRef.current = null;
    };
  }, []);

  const searchFor = useCallback(
    (email: string) => {
      const db = dbRef.current;
      if (!db) return;

      setSearchError(null);
      const t0 = performance.now();
      const profile = findByEmail(db, email, useIndex);
      const ms = performance.now() - t0;
      setResult({ email, ms, profile, useIndex });
    },
    [useIndex],
  );

  const search = useCallback(() => {
    const email = emailInput.trim();
    if (!email) {
      setSearchError('กรุณาใส่อีเมล');
      setResult(null);
      return;
    }
    searchFor(email);
  }, [emailInput, searchFor]);

  const searchRandom = useCallback(() => {
    if (rows === null || rows === 0) return;
    const id = 1 + Math.floor(Math.random() * rows);
    const email = emailForId(id);
    setEmailInput(email);
    searchFor(email);
  }, [rows, searchFor]);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.h1}>ค้นหาข้อมูล</Text>
      <Text style={s.dim}>
        {rows === null
          ? openError
            ? `เปิดฐานข้อมูลไม่ได้: ${openError}`
            : 'กำลังเปิดฐานข้อมูล…'
          : `พร้อมค้นหา ${rows.toLocaleString()} รายการ`}
      </Text>

      <View style={s.row}>
        <TextInput
          style={s.input}
          placeholder="ใส่อีเมล เช่น user500000@example.com"
          placeholderTextColor="#484f58"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={emailInput}
          onChangeText={setEmailInput}
          onSubmitEditing={search}
          editable={rows !== null}
        />
        <Pressable
          style={[s.btn, rows === null && s.btnDisabled]}
          disabled={rows === null}
          onPress={search}
        >
          <Text style={s.btnText}>ค้นหา</Text>
        </Pressable>
      </View>

      <Pressable
        style={[s.btn, s.btnAlt, rows === null && s.btnDisabled]}
        disabled={rows === null}
        onPress={searchRandom}
      >
        <Text style={s.btnText}>สุ่มอีเมลแล้วค้นหา</Text>
      </Pressable>

      <View style={s.toggleRow}>
        <Text style={s.dim}>
          {useIndex ? 'ใช้ index (เร็ว)' : 'ไม่ใช้ index — ไล่ทีละแถว (ช้า)'}
        </Text>
        <Switch value={useIndex} onValueChange={setUseIndex} />
      </View>

      {rows === null && !openError && <ActivityIndicator style={s.spinner} />}

      {searchError && (
        <View style={[s.card, s.errCard]}>
          <Text style={s.err}>{searchError}</Text>
        </View>
      )}

      {result && (
        <View style={s.card}>
          <Text style={s.dim}>
            ใช้เวลา ({result.useIndex ? 'มี index' : 'ไม่มี index'})
          </Text>
          <Text style={s.h2}>{fmtSeconds(result.ms)}</Text>
          <Text style={s.dim}>{result.email}</Text>

          {result.profile ? (
            <>
              <Field k="ชื่อ" v={result.profile.name} />
              <Field k="เบอร์โทร" v={result.profile.phone} />
              <Field k="เมือง" v={result.profile.city} />
              <Field k="สมัครเมื่อ" v={new Date(result.profile.created_at).toLocaleString('th-TH')} />
            </>
          ) : (
            <Text style={s.err}>ไม่พบข้อมูล</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
};

const Field = ({ k, v }: { k: string; v: string }): React.JSX.Element => (
  <View style={s.fieldRow}>
    <Text style={s.key}>{k}</Text>
    <Text style={s.val} selectable>
      {v}
    </Text>
  </View>
);

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  h1: { color: '#e6edf3', fontSize: 18, fontWeight: '700', marginTop: 8 },
  h2: { color: '#7ee787', fontSize: 22, fontWeight: '700' },
  dim: { color: '#8b949e', fontSize: 12 },
  spinner: { marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    flex: 1,
    backgroundColor: '#161b22',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e6edf3',
    fontSize: 14,
  },
  btn: {
    backgroundColor: '#238636',
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnAlt: { backgroundColor: '#1f6feb' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 12,
    gap: 4,
  },
  errCard: { borderColor: '#f85149' },
  err: { color: '#f85149', fontSize: 12 },
  fieldRow: { flexDirection: 'row', paddingVertical: 2 },
  key: { color: '#8b949e', fontSize: 12, width: 110 },
  val: { color: '#c9d1d9', fontSize: 12, flex: 1 },
});
