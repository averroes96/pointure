import { Tabs } from "expo-router";
import { Text } from "react-native";
import { COLORS } from "@/constants";

function TabIcon({ emoji }: { emoji: string }) {
  return <Text style={{ fontSize: 20 }}>{emoji}</Text>;
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopColor: COLORS.border,
        },
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: COLORS.white,
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Tableau de bord",
          tabBarLabel: "Accueil",
          tabBarIcon: () => <TabIcon emoji="🏠" />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scanner",
          tabBarLabel: "Scanner",
          tabBarIcon: () => <TabIcon emoji="📷" />,
        }}
      />
      <Tabs.Screen
        name="inventory/index"
        options={{
          title: "Stock bas",
          tabBarLabel: "Stock",
          tabBarIcon: () => <TabIcon emoji="📦" />,
        }}
      />
      {/* Hidden screens — navigated to programmatically */}
      <Tabs.Screen
        name="inventory/[id]"
        options={{ href: null, title: "Détail produit" }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ href: null }}
      />
    </Tabs>
  );
}
