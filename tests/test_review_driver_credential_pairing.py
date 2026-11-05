"""The review driver dials only a gateway it can claim, with that gateway's own credential.

The Code Review Sage cases of Kiro Crew's ``test/test_instance_credential_pairing.py``:
the driver's port probe considers only ports this process can claim, its fallback is a
port a source NAMED (never a guessed 5476), and its credential is the host resolver's
answer for the dialled port, including that resolver's refusal. One case is new here:
a host without the resolver gets no credential at all.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

import pytest

from code_review_sage.sage_lib import review_driver


class TestTheProbeOnlyDialsAClaimablePort:
    def test_sage_probe_only_considers_ports_this_process_can_claim(self) -> None:
        """An authenticated probe must never sweep for a stranger's gateway.

        Each candidate is probed with THAT port's own credential, so a blind range
        sweep would authenticate against whichever sibling answered first and this
        app would then create and delete review artifacts in that instance's store.
        With no self-declared port the list is empty and the caller falls back to a
        default whose request errors clearly -- failing closed rather than writing to
        a stranger.
        """
        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch.object(
                review_driver.store, "crew_home", return_value=Path("/nonexistent")
            ):
                assert review_driver._candidate_ports() == []

        with mock.patch.dict(os.environ, {"KIROCREW_PORT": "7811"}, clear=True):
            with mock.patch.object(
                review_driver.store, "crew_home", return_value=Path("/nonexistent")
            ):
                assert review_driver._candidate_ports() == [7811]

        # The parent gateway exports its ACTUAL bound port, which is the only numeric
        # source a `--port auto` instance has and the correct one when the requested
        # port was taken. It therefore leads, and remains self-declared: a pod drops
        # it precisely so it never inherits its parent's listener.
        with mock.patch.dict(
            os.environ,
            {"KIROCREW_BOUND_PORT": "7899", "KIROCREW_PORT": "5476"},
            clear=True,
        ):
            with mock.patch.object(
                review_driver.store, "crew_home", return_value=Path("/nonexistent")
            ):
                assert review_driver._candidate_ports() == [7899, 5476]


class TestReviewDriverDoesNotGuessASiblingPort:
    """The report-write base must be a port a source NAMED, never an invented 5476.

    _gateway_base probes candidate ports, each with its own credential. When none
    answers it may fall back only to a port _candidate_ports positively named; when
    NO source names one, guessing 5476 and dialing it with 5476's credential is how a
    review artifact gets created or pruned in whatever sibling owns that port.
    """

    def test_no_named_port_fails_closed_instead_of_guessing_5476(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(review_driver, "_RESOLVED_BASE", "", raising=False)
        monkeypatch.setattr(review_driver, "_candidate_ports", lambda: [])
        # If _gateway_base returned a base anyway, _api_request would read a
        # credential for it; assert it refuses instead.
        assert review_driver._gateway_base() == ""
        result = review_driver._api_request("GET", "/whatever")
        assert "error" in result
        assert "5476" not in review_driver._gateway_base()

    def test_a_named_port_is_still_used_as_the_fallback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(review_driver, "_RESOLVED_BASE", "", raising=False)
        monkeypatch.setattr(review_driver, "_candidate_ports", lambda: [7811])
        monkeypatch.setattr(review_driver, "_probe", lambda base, secret: False)
        # The unreachable fallback base must be the v4 literal, not localhost.
        assert review_driver._gateway_base() == "http://127.0.0.1:7811"

    def test_local_secret_honours_the_helper_refusal_and_does_not_read_crew_home(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # GPT F2: when the shared resolver FAILS CLOSED (returns "" because the
        # dialled family is uncovered or run/ is unreadable), _local_secret must
        # return that refusal directly. Falling through to crew_home()/.local_secret
        # would send a DIFFERENT listener's credential -- the desync this closes.
        crew_home = tmp_path / "crew_home"
        crew_home.mkdir()
        (crew_home / ".local_secret").write_text("home-wide-secret", encoding="utf-8")
        monkeypatch.setattr(review_driver.store, "crew_home", lambda: crew_home)
        # The shared resolver is present and refuses.
        monkeypatch.setattr(
            "kiro_crew.config.loader.read_local_secret",
            lambda port, dial_host=None: "",
        )
        assert review_driver._local_secret(7811) == ""

    def test_local_secret_returns_the_helper_value_when_it_resolves(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        crew_home = tmp_path / "crew_home"
        crew_home.mkdir()
        (crew_home / ".local_secret").write_text("home-wide-secret", encoding="utf-8")
        monkeypatch.setattr(review_driver.store, "crew_home", lambda: crew_home)
        monkeypatch.setattr(
            "kiro_crew.config.loader.read_local_secret",
            lambda port, dial_host=None: "listener-secret",
        )
        assert review_driver._local_secret(7811) == "listener-secret"

    def test_a_host_without_the_resolver_sends_no_credential(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """The built-in read ``<home>/.local_secret`` when the resolver was missing.

        That file names whichever gateway generation wrote it last, so this copy
        sends nothing instead.
        """
        crew_home = tmp_path / "crew_home"
        crew_home.mkdir()
        (crew_home / ".local_secret").write_text("home-wide-secret", encoding="utf-8")
        monkeypatch.setattr(review_driver.store, "crew_home", lambda: crew_home)
        real_attr = review_driver._host.attr
        monkeypatch.setattr(
            review_driver._host,
            "attr",
            lambda module, name: None
            if (module, name) == ("kiro_crew.config.loader", "read_local_secret")
            else real_attr(module, name),
        )
        assert review_driver._local_secret(7811) == ""
