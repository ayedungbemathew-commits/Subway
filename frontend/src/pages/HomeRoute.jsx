import { useAuth } from "../context/AuthContext";
import DashboardPage from "./DashboardPage";
import LandingPage from "./LandingPage";

export default function HomeRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
  }

  return user ? <DashboardPage /> : <LandingPage />;
}
