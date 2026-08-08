import { useRef, useState, type MouseEvent } from "react";
import { Link, Navigate } from "react-router";
import { Globe, Mail, MapPin, Phone, Play, Volume2, VolumeX } from "lucide-react";
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
import dotPattern from "@/assets/dot-pattern.svg";
import dotPatternWhite from "@/assets/dot-pattern-white.svg";

// ── Marketing content (client req #8) ────────────────────────────────────────
// ponytail: placeholders stand in for photography until the client sends the
// real assets.
const CONTACT = {
  phone: "+63 952 394 5402",
  email: "liquorinventorysolutions@gmail.com",
  facebook: "Liquor Inventory Solution - FNB Cost Control",
  facebookUrl: "https://www.facebook.com/bar.audit",
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
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full bg-no-repeat"
        style={{
          backgroundImage: `url(${dotPattern})`,
          backgroundPosition: "top left",
          backgroundSize: "auto",
        }}
      />
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
                <a href="#contact">Subscribe</a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="min-h-11 rounded-md border-none bg-sidebar-foreground px-6 text-sidebar hover:bg-sidebar-foreground/90"
              >
                <a href="#contact">On-Premise Solution</a>
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
 * Portrait product video (client req #8). Autoplaying audio is blocked by
 * every browser, so this autoplays muted on mount — the same pattern
 * Apple's product pages use — with a persistent "Tap to unmute" pill
 * inviting the visitor to turn sound on; it swaps to a plain speaker icon
 * once they've unmuted. Uses a custom play/pause overlay instead of the
 * native `controls` attribute, so no browser-chrome scrubber/volume/
 * fullscreen bar ever appears. The play button only shows while paused —
 * it's the "click to start" CTA; once playing, the motion itself is the
 * "this is playing" signal, so no icon sits on top of it. Clicking
 * anywhere on the video still toggles playback either way.
 */
function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

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

  function toggleMute(e: MouseEvent) {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        poster={lisVideoPoster}
        playsInline
        autoPlay
        muted
        loop
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      >
        <source src={lisVideoWebm} type="video/webm" />
        <source src={lisVideoMp4} type="video/mp4" />
      </video>
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause video" : "Play video"}
        className={`absolute inset-0 flex items-center justify-center transition-colors ${
          isPlaying ? "bg-transparent" : "bg-black/20 hover:bg-black/30"
        }`}
      >
        {!isPlaying && (
          <span className="flex size-16 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg">
            <Play className="size-7 translate-x-0.5" fill="currentColor" />
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={toggleMute}
        aria-label={isMuted ? "Unmute video" : "Mute video"}
        className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-black/60 py-2 pl-3 pr-4 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
      >
        {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        {isMuted && <span>Tap to unmute</span>}
      </button>
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
    <section id="about" className="bg-[#F3F3F3] text-foreground">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:py-24">
        <div className="max-w-lg">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-3xl font-bold uppercase tracking-tight text-sidebar sm:text-4xl">About Us</h2>
            <img src={lisLogo} alt="" className="size-14 object-contain" />
          </div>
          <p className="mt-8 text-base italic text-sidebar">Accuracy is Everything</p>
          <div className="mt-4 space-y-5 text-justify text-base leading-7 text-sidebar">
            {paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <p className="mt-8 whitespace-nowrap font-semibold text-sidebar">
            Liquor Inventory Solution, your Trusted Inventory Management partner!
          </p>
        </div>

        <div className="relative mx-auto w-full max-w-xs py-4 lg:mx-0 lg:ml-auto lg:max-w-sm">
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
      <div className="mx-auto max-w-6xl px-6 pb-8 pt-16 lg:pb-12 lg:pt-24">
        <h2 className="text-center text-3xl font-bold uppercase tracking-tight sm:text-4xl">Services</h2>
        <div className="mt-14 grid gap-10 sm:grid-cols-2">
          {services.map((service) => (
            <div key={service.title} className="flex flex-col items-center text-center">
              <img src={service.photo} alt={service.alt} className="w-full max-w-sm border border-sidebar-border/50 object-cover" />
              <h3 className="mt-6 text-lg font-bold uppercase tracking-wide text-white">{service.title}</h3>
              <p className="mt-4 max-w-sm text-justify text-base leading-6 text-white">{service.body}</p>
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
      <div className="mx-auto grid max-w-5xl gap-3 px-6 pb-16 pt-8 sm:grid-cols-2 lg:pb-24 lg:pt-12">
        <div className="flex h-full flex-col gap-3">
          <div className="flex-1 bg-muted/95 p-8" style={{ color: "#112555" }}>
            <h3 className="text-xl font-bold">Our Goal</h3>
            <p className="mt-4 text-base leading-6">
              To provide accurate, reliable, and efficient inventory solutions that help hospitality businesses
              protect their profits and operate with confidence.
            </p>
          </div>
          <div className="flex-1 bg-accent p-8" style={{ color: "#112555" }}>
            <h3 className="text-xl font-bold">Standalone Inventory Management System</h3>
            <p className="mt-4 text-base leading-6">
              For businesses that prefer an offline solution, we offer an on-premise system that runs on your
              dedicated computer, providing fast, secure, and reliable inventory management without requiring an
              internet connection.
            </p>
          </div>
        </div>

        <div className="bg-background p-8" style={{ color: "#112555" }}>
          <h3 className="text-xl font-bold">Cloud-Based Inventory Management System</h3>
          <p className="mt-4 text-base leading-6">
            Manage your inventory anytime, anywhere through our cloud-based platform.
          </p>
          <h3 className="mt-8 text-xl font-bold">Key Features</h3>
          <ul className="mt-4 space-y-2 text-base leading-6">
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
/** Facebook glyph (client-provided asset), drawn to match the stroke-icon
 * style (lucide-react) used by the rest of the contact row icons so it
 * doesn't stand out as a different icon set. */
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function ContactSection() {
  const rows = [
    { icon: Phone, label: CONTACT.phone, href: `tel:${CONTACT.phone.replace(/[^+\d]/g, "")}` },
    { icon: Mail, label: CONTACT.email, href: `mailto:${CONTACT.email}` },
    { icon: FacebookIcon, label: CONTACT.facebook, href: CONTACT.facebookUrl },
    { icon: Globe, label: CONTACT.website, href: `https://${CONTACT.website}` },
    { icon: MapPin, label: CONTACT.address },
  ];
  return (
    <section id="contact" className="relative overflow-hidden bg-[#F3F3F3] text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full bg-no-repeat"
        style={{
          backgroundImage: `url(${dotPatternWhite})`,
          backgroundPosition: "top left",
          backgroundSize: "auto",
        }}
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <h2 className="text-4xl font-bold uppercase tracking-tight sm:text-5xl" style={{ color: "#112555" }}>Contact Us</h2>
        <div>
          {rows.map((row) => (
            <div key={row.label}>
              {row.href ? (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 py-4 transition-opacity hover:opacity-70"
                  style={{ color: "#112555" }}
                >
                  <row.icon className="size-5 shrink-0" />
                  <span className="text-sm font-semibold">{row.label}</span>
                </a>
              ) : (
                <div className="flex items-center gap-4 py-4" style={{ color: "#112555" }}>
                  <row.icon className="size-5 shrink-0" />
                  <span className="text-sm font-semibold">{row.label}</span>
                </div>
              )}
              <div
                aria-hidden="true"
                className="h-1.5 w-full"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='6' viewBox='0 0 8 6'%3E%3Ccircle cx='3' cy='3' r='1.5' fill='%23112555'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "repeat-x",
                  backgroundPosition: "left center",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
