#
# Copyright (c) 2014, Joyent, Inc. All rights reserved.
#

#
# Files
#
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell ls *.js 2>/dev/null) \
		   $(shell find lib test -name '*.js' 2>/dev/null)
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=4,doxygen,unparenthesized-return=0
SMF_MANIFESTS_IN = smf/manifests/hagfish-watcher.xml.in

NODE_VERSION	 = v0.10.26
NODE_BASE_URL	 = http://nodejs.org/dist/$(NODE_VERSION)
NODE_TARBALL	 = node-$(NODE_VERSION)-sunos-x86.tar.gz

NODE_EXEC	 = $(TOP)/build/node/bin/node
NPM_EXEC	 = $(NODE_EXEC) $(TOP)/build/node/bin/npm --unsafe-perm false

CLEAN_FILES	+= node node_modules downloads

include ./tools/mk/Makefile.defs
include ./tools/mk/Makefile.smf.defs

NAME		:= hagfish-watcher
RELEASE_TARBALL := $(NAME)-$(STAMP).tgz
RELSTAGEDIR	:= /tmp/$(STAMP)
NODEUNIT	 = $(TOP)/node_modules/.bin/nodeunit

#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NODE_EXEC) $(REPO_DEPS)
	$(NPM_EXEC) install && $(NPM_EXEC) update

$(NODEUNIT): | $(NODE_EXEC)
	$(NPM_EXEC) install

CLEAN_FILES += $(NODEUNIT) ./node_modules/tap

.PHONY: test
test: $(NODEUNIT)
	$(NODEUNIT) --reporter=tap test/test-*.js

$(TOP)/downloads/$(NODE_TARBALL):
	mkdir -p $(TOP)/downloads
	curl -f -kL -o $@ '$(NODE_BASE_URL)/$(NODE_TARBALL)'
	touch $@

$(NODE_EXEC): $(TOP)/downloads/$(NODE_TARBALL)
	@echo "extracting node $(NODE_VERSION) ..."
	mkdir -p $(TOP)/build/node
	gtar -xz -C $(TOP)/build/node --strip-components=1 \
	    -f downloads/$(NODE_TARBALL)
	touch $@

.PHONY: release
release: all deps docs $(SMF_MANIFESTS)
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/$(NAME)
	cd $(TOP) && $(NPM_EXEC) install
	cp -r \
	$(TOP)/Makefile \
	$(TOP)/bin \
	$(TOP)/build \
	$(TOP)/config \
	$(TOP)/lib \
	$(TOP)/node_modules \
	$(TOP)/npm \
	$(TOP)/package.json \
	$(TOP)/smf \
	$(RELSTAGEDIR)/hagfish-watcher
	json -f $(TOP)/package.json -e 'this.version += "-$(STAMP)"' \
	    > $(RELSTAGEDIR)/hagfish-watcher/package.json
	(cd $(RELSTAGEDIR) && $(TAR) -zcf $(TOP)/$(RELEASE_TARBALL) *)
	@rm -rf $(RELSTAGEDIR)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
		@echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/$(NAME)
	cp $(TOP)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)

.PHONY: dumpvar
dumpvar:
	@if [[ -z "$(VAR)" ]]; then \
		echo "error: set 'VAR' to dump a var"; \
		exit 1; \
	fi
	@echo "$(VAR) is '$($(VAR))'"

include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ
