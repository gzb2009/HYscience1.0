import { Navigate } from "@solidjs/router"
import DomainGuide from "@/pages/domain-guide"
import { lastSelectedDomain } from "@/domain/store"

export default function HomeEntry() {
  const last = lastSelectedDomain()
  if (last) return <Navigate href={`/domain/${last}`} />
  return <DomainGuide />
}
