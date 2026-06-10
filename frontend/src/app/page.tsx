"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to login on first visit
    const token = localStorage.getItem("dinamyt_token");
    if (token) {
      const user = localStorage.getItem("dinamyt_user");
      if (user) {
        const parsed = JSON.parse(user);
        router.replace(parsed.rol === "admin" ? "/admin" : "/juez");
        return;
      }
    }
    router.replace("/login");
  }, [router]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
    }}>
      <div className="logo animate-fade">DINA<em>MYT</em></div>
    </div>
  );
}
