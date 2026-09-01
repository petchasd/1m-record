import { StatusBar, StyleSheet, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { SearchScreen } from './src/screens/SearchScreen';

const Shell = (): React.JSX.Element => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <SearchScreen />
    </View>
  );
};

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      {/* RN 0.87 runs edge-to-edge; StatusBar.backgroundColor was removed.
          The root View below paints behind the bar instead. */}
      <StatusBar barStyle="light-content" />
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
});

export default App;
