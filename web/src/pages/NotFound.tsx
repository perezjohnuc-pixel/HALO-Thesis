import { Link } from "react-router-dom";
import { Card, CardBody, Button } from "../components/ui";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-sky-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <Card className="w-full max-w-lg">
          <CardBody>
            <div className="text-2xl font-semibold">Page not found</div>
            <p className="mt-2 text-sm text-slate-400">
              The link you opened doesn&rsquo;t exist or you don&rsquo;t have access.
            </p>
            <div className="mt-6">
              <Link to="/">
                <Button>Go to Dashboard</Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
