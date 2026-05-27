import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState } from "../components/EmptyState.tsx";

export function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description={
        <span>
          That route doesn't exist.{" "}
          <Link to="/agents" className="text-emerald-400 hover:underline">
            Back to agents
          </Link>
          .
        </span>
      }
    />
  );
}
