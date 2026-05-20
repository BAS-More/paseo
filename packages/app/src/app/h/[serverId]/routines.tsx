import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { RoutinesScreen } from "@/screens/routines-screen";

export default function HostRoutinesRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostRoutinesRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostRoutinesRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";

  return <RoutinesScreen serverId={serverId} />;
}
