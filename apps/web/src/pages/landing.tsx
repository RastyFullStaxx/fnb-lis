import { useRef, useState } from "react";
import { Link, Navigate } from "react-router";
import { Globe, Mail, MapPin, Phone, Play, Share2 } from "lucide-react";
import { useMe } from "@/api/auth";
import { Button } from "@/components/ui/button";
import lisLogo from "@/assets/lis-logo.png";
import barKitchenLogo from "@/assets/bar-kitchen-logo.png";
import lisVideoMp4 from "@/assets/video/lis-video.mp4";
import lisVideoWebm from "@/assets/video/lis-video.webm";
import lisVideoPoster from "@/assets/video/lis-video-poster.jpg";
import aboutBarPhoto from "@/assets/photos/about-bar.png";
import aboutKitchenPhoto from "@/assets/photos/about-kitchen.png";
import servicesSharedPhoto from "@/assets/photos/services-shared.png";
import servicesJoinedPhoto from "@/assets/photos/services-joined.png";

// ── Marketing content (client req #8) ────────────────────────────────────────
// ponytail: placeholders stand in for photography until the client sends the
// real assets.
const CONTACT = {
  phone: "+63 952 394 5402",
  email: "liquorinventorysolutions@gmail.com",
  facebook: "Liquor Inventory Solution - FNB Cost Control",
  website: "www.barandkitchencontrol.com",
  address: "Pasig City, Philippines",
};

/**
 * Public landing page (client req #8). Royal-ink drench — the brand's one
 * committed surface carries the dark sections, with light panels for the
 * About/Goal content, mirroring the client's reference deck section-for-
 * section: Home → About → Services → Goal/System → Contact. Renders
 * instantly for visitors; a signed-in user hitting "/" is bounced straight
 * to their dashboard once the background session probe resolves.
 */
export function LandingPage() {
  const me = useMe();
  const firstLocation = me.data?.clients.flatMap((c) => c.locations)[0];
  if (firstLocation) return <Navigate to={`/l/${firstLocation.id}/dashboard`} replace />;
  // Signed in, but no location to land on — say so instead of silently
  // looping between the landing and the login form.
  const signedInNoLocations = Boolean(me.data) && !firstLocation;

  return (
    <div className="min-h-dvh bg-sidebar text-sidebar-foreground">
      {signedInNoLocations && (
        <div role="status" className="bg-background px-6 py-2.5 text-center text-sm text-foreground">
          You're signed in as {me.data!.user.username}, but no client locations are assigned to your account yet —
          ask an administrator to assign you.
        </div>
      )}

      <HomeSection />
      <AboutSection />
      <ServicesSection />
      <GoalSystemSection />
      <ContactSection />

      <footer className="border-t border-sidebar-border/60 bg-sidebar">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-sidebar-foreground/60">
          <span>© {new Date().getFullYear()} Liquor Inventory Solution. All rights reserved.</span>
          <span>Your partner in inventory management</span>
        </div>
      </footer>
    </div>
  );
}

const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "About", href: "#about" },
  { label: "Services", href: "#services" },
  { label: "Contact", href: "#contact" },
];

/* ── Home ─────────────────────────────────────────────────────────────────── */
function HomeSection() {
  return (
    <section id="home" className="relative overflow-hidden">
      <div aria-hidden="true" className="landing-dot-grid pointer-events-none absolute inset-0" />
      <div className="relative grid lg:grid-cols-[1.1fr_0.9fr] lg:h-dvh">
        {/* Left: nav + hero copy */}
        <div className="mx-auto flex w-full max-w-xl flex-col px-6 py-6 lg:py-10">
          <nav className="landing-rise flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium uppercase tracking-wide text-sidebar-foreground">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground"
              >
                {link.label}
              </a>
            ))}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-full border-none bg-sidebar-foreground text-sidebar normal-case tracking-normal hover:bg-sidebar-foreground/90"
            >
              <Link to="/login">Sign In</Link>
            </Button>
          </nav>

          <div className="mt-10 flex flex-1 flex-col items-center justify-center pb-10 text-center lg:mt-14 lg:pb-16">
            <img src={barKitchenLogo} alt="Bar &amp; Kitchen Control, powered by Liquor Inventory Solution" className="landing-rise landing-rise-2 size-64 object-contain sm:size-72" />
            <h1 className="landing-rise landing-rise-3 mt-8 whitespace-nowrap text-lg font-semibold leading-tight tracking-tight sm:text-2xl lg:text-3xl">
              Bar &amp; Kitchen Control + Asset Management
            </h1>
            <p className="landing-rise landing-rise-3 mt-2 text-balance text-lg italic text-sidebar-foreground/80">
              "Your Partner in Inventory Management"
            </p>

            <div className="landing-rise landing-rise-4 mt-16 flex flex-wrap items-center justify-center gap-4">
              <Button
                asChild
                variant="outline"
                className="min-h-11 rounded-md border-none bg-sidebar-foreground px-6 text-sidebar hover:bg-sidebar-foreground/90"
              >
                <Link to="/login">Subscribe</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="min-h-11 rounded-md border-none bg-sidebar-foreground px-6 text-sidebar hover:bg-sidebar-foreground/90"
              >
                <Link to="/login">On-Premise Solution</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Right: the product in use — has audio, so it stays paused until the visitor taps play */}
        <div className="landing-rise landing-rise-3 mx-auto aspect-[9/16] w-full max-w-sm lg:mx-0 lg:aspect-auto lg:h-full lg:max-w-md">
          <HeroVideo />
        </div>
      </div>
    </section>
  );
}

/**
 * Portrait product video with sound. Autoplaying audio is blocked by every
 * browser anyway, so this stays paused behind its poster frame until the
 * visitor chooses to play it — a real control, not a muted loop.
 */
function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        poster={lisVideoPoster}
        playsInline
        controls={isPlaying}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      >
        <source src={lisVideoWebm} type="video/webm" />
        <source src={lisVideoMp4} type="video/mp4" />
      </video>
      {!isPlaying && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg">
            <Play className="size-7 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      )}
    </div>
  );
}

/* ── About ────────────────────────────────────────────────────────────────── */
function AboutSection() {
  const paragraphs = [
    "Liquor Inventory Solution provides inventory management services and systems for bars, restaurants, cafés, hotels, clubs, pubs, and other hospitality businesses.",
    "With over 20 years of experience, we help businesses reduce waste, prevent pilferage, control costs, and improve profitability through accurate inventory audits and reliable reporting.",
    "Our Bar & Kitchen plus Asset Inventory Management System tracks inventory, purchases, sales, and non-revenue items, giving you the information you need to make better business decisions.",
    "We help you stay in control of your inventory so you can focus on growing your business.",
  ];
  return (
    <section id="about" className="bg-background text-foreground">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:py-24">
        <div>
          <div className="flex items-center gap-4">
            <h2 className="text-3xl font-bold uppercase tracking-tight sm:text-4xl">About Us</h2>
            <img src={lisLogo} alt="" className="size-14 object-contain" />
          </div>
          <p className="mt-8 text-base italic text-muted-foreground">Accuracy is Everything</p>
          <div className="mt-4 space-y-5 text-[15px] leading-7 text-foreground/90">
            {paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <p className="mt-8 font-semibold">Liquor Inventory Solution, your Trusted Inventory Management partner!</p>
        </div>

        <div className="relative mx-auto w-full max-w-xs py-4 lg:mx-0 lg:max-w-sm">
          <div className="relative ml-auto w-[70%]">
            <div aria-hidden="true" className="absolute -bottom-3 -right-3 h-full w-full bg-sidebar" />
            <img
              src={aboutBarPhoto}
              alt="Bar counter inventory audit in progress"
              className="relative w-full object-cover"
            />
          </div>
          <div className="relative mt-8 w-[70%]">
            <div aria-hidden="true" className="absolute -bottom-3 -right-3 h-full w-full bg-sidebar" />
            <img
              src={aboutKitchenPhoto}
              alt="Kitchen inventory audit in progress"
              className="relative w-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Services ─────────────────────────────────────────────────────────────── */
function ServicesSection() {
  const services = [
    {
      title: "Shared Service",
      body: "Your staff performs the inventory count while we process, reconcile, and analyze the data to deliver accurate inventory reports.",
      photo: servicesSharedPhoto,
      alt: "Weighing a bottle on a scale next to the audit laptop screen",
    },
    {
      title: "Joined Service",
      body: "Our inventory specialists conduct the physical inventory count with your staff and prepare complete inventory audit reports.",
      photo: servicesJoinedPhoto,
      alt: "Weighing a kitchen ingredient on a scale next to the audit laptop screen",
    },
  ];
  return (
    <section id="services" className="bg-sidebar text-sidebar-foreground">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
        <h2 className="text-center text-3xl font-bold uppercase tracking-tight sm:text-4xl">Services</h2>
        <div className="mt-14 grid gap-10 sm:grid-cols-2">
          {services.map((service) => (
            <div key={service.title} className="flex flex-col items-center text-center">
              <img src={service.photo} alt={service.alt} className="w-full max-w-sm border border-sidebar-border/50 object-cover" />
              <h3 className="mt-6 text-lg font-bold uppercase tracking-wide">{service.title}</h3>
              <p className="mt-4 max-w-sm text-sm leading-6 text-sidebar-foreground/75">{service.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Goal / Cloud & Standalone system ────────────────────────────────────── */
function GoalSystemSection() {
  const features = [
    "Inventory counting and stock monitoring",
    "Automated calculations",
    "Purchase and sales tracking",
    "Daily, weekly, and monthly reports",
    "Variance, wastage, and pilferage analysis",
    "Performance and profitability reports",
  ];
  return (
    <section className="bg-sidebar text-sidebar-foreground">
      <div className="mx-auto grid max-w-6xl gap-3 px-6 py-16 sm:grid-cols-2 lg:py-24">
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-muted/95 p-8 text-foreground">
            <h3 className="text-xl font-bold">Our Goal</h3>
            <p className="mt-4 text-sm leading-6 text-foreground/80">
              To provide accurate, reliable, and efficient inventory solutions that help hospitality businesses
              protect their profits and operate with confidence.
            </p>
          </div>
          <div className="rounded-lg bg-accent p-8 text-accent-foreground">
            <h3 className="text-xl font-bold">Standalone Inventory Management System</h3>
            <p className="mt-4 text-sm leading-6 text-accent-foreground/80">
              For businesses that prefer an offline solution, we offer an on-premise system that runs on your
              dedicated computer, providing fast, secure, and reliable inventory management without requiring an
              internet connection.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-background p-8 text-foreground">
          <h3 className="text-xl font-bold">Cloud-Based Inventory Management System</h3>
          <p className="mt-4 text-sm leading-6 text-foreground/80">
            Manage your inventory anytime, anywhere through our cloud-based platform.
          </p>
          <h3 className="mt-8 text-xl font-bold">Key Features</h3>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-foreground/80">
            {features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span aria-hidden="true">-</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ── Contact ──────────────────────────────────────────────────────────────── */
function ContactSection() {
  const rows = [
    { icon: Phone, label: CONTACT.phone },
    { icon: Mail, label: CONTACT.email },
    { icon: Share2, label: CONTACT.facebook },
    { icon: Globe, label: CONTACT.website },
    { icon: MapPin, label: CONTACT.address },
  ];
  return (
    <section id="contact" className="bg-background text-foreground">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-5xl">Contact Us</h2>
        <div className="divide-y divide-dashed divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-4 py-4">
              <row.icon className="size-5 shrink-0 text-foreground" />
              <span className="text-sm font-semibold">{row.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
