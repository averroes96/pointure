import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { isLoggedIn } from "@/lib/auth";

export default function Index() {
  const [checked, setChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    isLoggedIn().then((v) => {
      setLoggedIn(v);
      setChecked(true);
    });
  }, []);

  if (!checked) return null;
  return <Redirect href={loggedIn ? "/(app)" : "/(auth)/login"} />;
}
