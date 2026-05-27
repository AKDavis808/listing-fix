import { useLocation } from "react-router";

export function ListingFixAppNav() {
  const location = useLocation();
  const href = location.search ? `/app${location.search}` : "/app";

  return (
    <s-app-nav>
      <s-link href={href}>ListingFix</s-link>
    </s-app-nav>
  );
}
