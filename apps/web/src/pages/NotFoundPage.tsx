import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Page } from './_shared';

/**
 * 404.
 *
 * Shows the path that was not found, because "page not found" without saying
 * which page is a dead end for anyone who mistyped a link or followed an old
 * bookmark.
 */
export function NotFoundPage() {
  const location = useLocation();

  return (
    <Page>
      <div className="mx-auto max-w-xl pt-16">
        <EmptyState
          icon={Compass}
          title="That page does not exist"
          description={
            <span>
              Nothing is routed at <span className="font-mono text-[12px]">{location.pathname}</span>. It may have
              moved, or the link may be out of date.
            </span>
          }
        />
        <div className="flex justify-center gap-2">
          <Link to="/">
            <Button variant="primary">Go to the dashboard</Button>
          </Link>
          <Button variant="ghost" onClick={() => window.history.back()}>
            Go back
          </Button>
        </div>
      </div>
    </Page>
  );
}
