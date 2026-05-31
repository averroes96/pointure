import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { C } from "@/constants";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

function TabIcon({
  name,
  focused,
}: {
  name: IoniconsName;
  focused: boolean;
}) {
  return (
    <Ionicons
      name={name}
      size={22}
      color={focused ? C.primary : C.textMuted}
    />
  );
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textMuted,
        tabBarStyle: {
          backgroundColor: C.white,
          borderTopColor: C.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerStyle: { backgroundColor: C.white, shadowColor: "transparent" },
        headerTintColor: C.text,
        headerTitleStyle: { fontWeight: "700", fontSize: 17, color: C.text },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Tableau de bord",
          tabBarLabel: "Accueil",
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? "home" : "home-outline"} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scanner",
          tabBarLabel: "Scanner",
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? "barcode" : "barcode-outline"} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventory/index"
        options={{
          title: "Stock bas",
          tabBarLabel: "Stock",
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? "cube" : "cube-outline"} focused={focused} />
          ),
        }}
      />
      {/* Hidden — navigated to programmatically */}
      <Tabs.Screen name="inventory/[id]" options={{ href: null, title: "Détail produit" }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}
